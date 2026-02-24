import mongoose from "mongoose";
import crypto from "crypto";
import { EnergyGenerationRecord } from "./entities/EnergyGenerationRecord";
import { SolarUnit } from "./entities/SolarUnit";
import { calculateEnergyGeneration } from "./energy-generation-cron";
import dotenv from "dotenv";
import { connectDB } from "./db";

dotenv.config();

// ── Solar Unit Fleet ──────────────────────────────────────────
// These simulate a realistic deployment of solar installations
// across different locations, capacities, and configurations.

interface UnitDefinition {
  serialNumber: string;
  name: string;
  capacity: number; // Watts
  location: { latitude: number; longitude: number; timezone: string };
  metadata: {
    panelType: string;
    inverterModel: string;
    tiltAngle: number;
    azimuth: number;
  };
  // Which anomaly patterns to inject for this unit (if any)
  anomalyPatterns?: AnomalyPattern[];
}

const SOLAR_UNITS: UnitDefinition[] = [
  {
    serialNumber: "SU-0001",
    name: "Rooftop Array A — Main Building",
    capacity: 5000,
    location: { latitude: 6.9271, longitude: 79.8612, timezone: "Asia/Colombo" },
    metadata: {
      panelType: "monocrystalline",
      inverterModel: "SMA Sunny Boy 5.0",
      tiltAngle: 10,
      azimuth: 180,
    },
    anomalyPatterns: [
      // This unit has anomaly patterns for demo anomaly detection
      {
        type: "ZERO_PRODUCTION",
        description: "Complete equipment failure",
        startDaysAgo: 6,
        durationDays: 2,
        effect: () => 0,
      },
      {
        type: "SENSOR_SPIKE",
        description: "Unrealistic high reading",
        startDaysAgo: 3,
        durationDays: 1,
        effect: (base) => base * 5,
      },
    ],
  },
  {
    serialNumber: "SU-0002",
    name: "Ground Mount — Field Station",
    capacity: 10000,
    location: { latitude: 7.2906, longitude: 80.6337, timezone: "Asia/Colombo" },
    metadata: {
      panelType: "polycrystalline",
      inverterModel: "Fronius Primo 10.0",
      tiltAngle: 15,
      azimuth: 170,
    },
    anomalyPatterns: [
      {
        type: "GRADUAL_DEGRADATION",
        description: "Slow decline due to soiling",
        startDaysAgo: 20,
        durationDays: 10,
        effect: (base, dayOffset) => base * (0.95 - dayOffset * 0.06),
      },
    ],
  },
  {
    serialNumber: "SU-0003",
    name: "Carport Solar — Parking Level 2",
    capacity: 3000,
    location: { latitude: 6.8649, longitude: 79.8997, timezone: "Asia/Colombo" },
    metadata: {
      panelType: "thin-film",
      inverterModel: "Huawei SUN2000-3KTL",
      tiltAngle: 5,
      azimuth: 190,
    },
    // No anomalies — this unit runs cleanly (control unit for comparison)
  },
  {
    serialNumber: "SU-0004",
    name: "Warehouse Rooftop — Zone B",
    capacity: 8000,
    location: { latitude: 7.4818, longitude: 80.3609, timezone: "Asia/Colombo" },
    metadata: {
      panelType: "monocrystalline",
      inverterModel: "SolarEdge SE7600H",
      tiltAngle: 12,
      azimuth: 175,
    },
    anomalyPatterns: [
      {
        type: "INTERMITTENT_FAILURE",
        description: "Loose connector causing sporadic dropouts",
        startDaysAgo: 9,
        durationDays: 1,
        intermittentDays: [4, 6, 9], // Specific days ago
        effect: () => 0,
      },
      {
        type: "SIGNIFICANT_DROP",
        description: "Partial shading from new construction",
        startDaysAgo: 14,
        durationDays: 3,
        effect: (base) => base * 0.35,
      },
    ],
  },
  {
    serialNumber: "SU-0005",
    name: "Research Lab — East Wing",
    capacity: 2000,
    location: { latitude: 6.7956, longitude: 79.9007, timezone: "Asia/Colombo" },
    metadata: {
      panelType: "bifacial",
      inverterModel: "Enphase IQ7+",
      tiltAngle: 20,
      azimuth: 160,
    },
    // Clean — used as a small residential-scale reference
  },
];

// ── Anomaly Pattern Definitions ───────────────────────────────

interface AnomalyPattern {
  type: string;
  description: string;
  startDaysAgo: number;
  durationDays: number;
  intermittentDays?: number[];
  effect: (baseEnergy: number, dayOffset: number) => number;
}

function getAnomalyMultiplier(
  timestamp: Date,
  endDate: Date,
  patterns: AnomalyPattern[]
): { multiplier: number; pattern?: string } {
  const daysAgo = Math.floor(
    (endDate.getTime() - timestamp.getTime()) / (1000 * 60 * 60 * 24)
  );

  for (const pattern of patterns) {
    if (pattern.type === "INTERMITTENT_FAILURE" && pattern.intermittentDays) {
      if (pattern.intermittentDays.includes(daysAgo)) {
        const hour = timestamp.getUTCHours();
        if (hour >= 10 && hour <= 14) {
          return { multiplier: 0, pattern: pattern.type };
        }
      }
    } else {
      const patternStart = pattern.startDaysAgo;
      const patternEnd = pattern.startDaysAgo - pattern.durationDays;
      if (daysAgo <= patternStart && daysAgo > patternEnd) {
        const dayOffset = patternStart - daysAgo;
        return {
          multiplier: pattern.effect(1, dayOffset),
          pattern: pattern.type,
        };
      }
    }
  }

  return { multiplier: 1 };
}

function generateApiKey(): string {
  return `sp_dev_${crypto.randomBytes(16).toString("hex")}`;
}

// ── Seed Script ───────────────────────────────────────────────

async function seed() {
  try {
    await connectDB();

    // Clear existing data
    await EnergyGenerationRecord.deleteMany({});
    await SolarUnit.deleteMany({});

    console.log("───────────────────────────────────────");
    console.log(" SolarPulse Data API — Seeding");
    console.log("───────────────────────────────────────\n");

    // 1) Register all solar units
    console.log(`Registering ${SOLAR_UNITS.length} solar units...\n`);

    const createdUnits = [];
    for (const unitDef of SOLAR_UNITS) {
      const apiKey = generateApiKey();
      const unit = await SolarUnit.create({
        serialNumber: unitDef.serialNumber,
        name: unitDef.name,
        capacity: unitDef.capacity,
        location: unitDef.location,
        metadata: unitDef.metadata,
        apiKey,
        status: "ONLINE",
      });
      createdUnits.push({ unit, definition: unitDef, apiKey });
      console.log(
        `  ✓ ${unit.serialNumber} | ${unit.name} | ${unit.capacity}W | API Key: ${apiKey}`
      );
    }

    // 2) Generate historical data for all units
    const startDate = new Date("2025-08-01T08:00:00Z");
    const endDate = new Date();
    const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
    const BATCH_SIZE = 5000; // Insert in batches to avoid memory issues

    console.log(
      `\nGenerating historical data from ${startDate.toDateString()} to ${endDate.toDateString()}...\n`
    );

    let totalRecords = 0;
    let totalAnomalies = 0;

    for (const { unit, definition } of createdUnits) {
      let currentDate = new Date(startDate);
      let unitRecords = 0;
      let unitAnomalies = 0;
      let batch: any[] = [];

      while (currentDate <= endDate) {
        let energyGenerated = calculateEnergyGeneration(currentDate, {
          capacity: unit.capacity,
          location: unit.location,
          metadata: unit.metadata,
        });

        // Apply anomaly patterns if defined for this unit
        if (definition.anomalyPatterns && definition.anomalyPatterns.length > 0) {
          const anomalyResult = getAnomalyMultiplier(
            currentDate,
            endDate,
            definition.anomalyPatterns
          );
          if (anomalyResult.pattern) {
            energyGenerated = Math.round(energyGenerated * anomalyResult.multiplier);
            unitAnomalies++;
          }
        }

        batch.push({
          serialNumber: unit.serialNumber,
          timestamp: new Date(currentDate),
          energyGenerated,
          intervalHours: 2,
          metadata: { source: "seed" },
        });

        // Flush batch periodically
        if (batch.length >= BATCH_SIZE) {
          await EnergyGenerationRecord.insertMany(batch);
          batch = [];
        }

        currentDate = new Date(currentDate.getTime() + TWO_HOURS_MS);
        unitRecords++;
      }

      // Flush remaining
      if (batch.length > 0) {
        await EnergyGenerationRecord.insertMany(batch);
      }

      totalRecords += unitRecords;
      totalAnomalies += unitAnomalies;

      console.log(
        `  ✓ ${unit.serialNumber}: ${unitRecords.toLocaleString()} records | ${unitAnomalies} anomaly records`
      );
    }

    console.log("\n───────────────────────────────────────");
    console.log(` Seed complete!`);
    console.log(` Units registered: ${createdUnits.length}`);
    console.log(` Total records: ${totalRecords.toLocaleString()}`);
    console.log(` Anomaly records: ${totalAnomalies}`);
    console.log("───────────────────────────────────────\n");

    // Print API keys for reference
    console.log("Device API Keys (for testing IoT ingestion):");
    createdUnits.forEach(({ unit, apiKey }) => {
      console.log(`  ${unit.serialNumber}: ${apiKey}`);
    });
    console.log(
      "\nUse these with: curl -X POST http://localhost:8001/api/ingest -H 'X-API-Key: <key>' -H 'Content-Type: application/json' -d '{\"energyGenerated\": 250}'\n"
    );
  } catch (err) {
    console.error("Seeding error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

seed();
