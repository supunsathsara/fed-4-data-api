import cron from 'node-cron';
import { EnergyGenerationRecord } from './entities/EnergyGenerationRecord';
import { SolarUnit } from './entities/SolarUnit';

/**
 * Energy Generation Simulator
 *
 * In production, this cron would NOT exist — real IoT devices would POST
 * readings via the /api/ingest endpoint. This simulator exists to:
 *
 * 1. Generate realistic test data during development
 * 2. Demonstrate the system with multiple solar units
 * 3. Simulate varying conditions (weather, panel orientation, capacity)
 *
 * Each registered unit gets its own simulated readings based on its:
 * - capacity (Watts)
 * - location (latitude affects daylight hours)
 * - metadata.tiltAngle / azimuth (affects efficiency)
 */

/**
 * Calculate realistic energy generation for a specific solar unit
 * Takes into account the unit's capacity, location, and panel characteristics
 */
export function calculateEnergyGeneration(
  timestamp: Date,
  unit: {
    capacity: number;
    location?: { latitude?: number } | null;
    metadata?: { tiltAngle?: number; azimuth?: number } | null;
  }
): number {
  const hour = timestamp.getUTCHours();
  const month = timestamp.getUTCMonth();
  const latitude = unit.location?.latitude ?? 7.0; // Default: ~Sri Lanka

  // Scale base energy relative to capacity (normalized to 5000W reference)
  const capacityFactor = unit.capacity / 5000;

  // Seasonal variation based on latitude
  // Higher latitudes have more dramatic seasonal shifts
  const latFactor = Math.abs(latitude) / 90; // 0 (equator) → 1 (pole)
  const seasonAngle = ((month - 5.5) / 6) * Math.PI; // Peak at June
  const seasonMultiplier =
    latitude >= 0
      ? 1 + latFactor * 0.5 * Math.cos(seasonAngle) // Northern hemisphere
      : 1 - latFactor * 0.5 * Math.cos(seasonAngle); // Southern hemisphere

  const baseEnergy = 200 * capacityFactor * seasonMultiplier;

  // Time-of-day solar curve (bell curve peaking at solar noon)
  let timeMultiplier = 0;
  if (hour >= 6 && hour <= 18) {
    // Gaussian-like curve centered at noon (hour 12)
    const hoursFromNoon = Math.abs(hour - 12);
    timeMultiplier = Math.exp(-0.15 * hoursFromNoon * hoursFromNoon);
  }

  // Panel efficiency modifiers
  const tiltAngle = unit.metadata?.tiltAngle ?? 30;
  const tiltEfficiency = 1 - Math.abs(tiltAngle - latitude) * 0.005; // Optimal tilt ≈ latitude

  // Random variation (±15%) — simulates cloud cover, dust, etc.
  const variation = 0.85 + Math.random() * 0.3;

  const energyGenerated = Math.round(
    baseEnergy * timeMultiplier * tiltEfficiency * variation
  );

  return Math.max(0, energyGenerated);
}

/**
 * Generate simulated sensor metadata
 */
function simulateSensorMetadata(energyGenerated: number, hour: number) {
  if (energyGenerated === 0) {
    return { voltage: 0, current: 0, temperature: 20 + Math.random() * 5, irradiance: 0 };
  }
  const irradiance = 200 + Math.random() * 800; // W/m²
  const temperature = 25 + (irradiance / 100) + Math.random() * 10; // Panel heats up with irradiance
  const voltage = 230 + Math.random() * 20; // Grid voltage ~230-250V
  const current = energyGenerated / voltage;

  return {
    voltage: Math.round(voltage * 10) / 10,
    current: Math.round(current * 100) / 100,
    temperature: Math.round(temperature * 10) / 10,
    irradiance: Math.round(irradiance),
  };
}

/**
 * Generate a new energy generation record for ALL registered online units
 */
async function generateRecordsForAllUnits() {
  try {
    const timestamp = new Date();
    const hour = timestamp.getUTCHours();

    // Find all ONLINE units (OFFLINE and MAINTENANCE units don't produce)
    const onlineUnits = await SolarUnit.find({ status: 'ONLINE' });

    if (onlineUnits.length === 0) {
      console.log(`[Energy Sim] No online units found — skipping`);
      return;
    }

    const records = onlineUnits.map((unit) => {
      const energyGenerated = calculateEnergyGeneration(timestamp, unit);
      const sensorMeta = simulateSensorMetadata(energyGenerated, hour);

      return {
        serialNumber: unit.serialNumber,
        timestamp,
        energyGenerated,
        intervalHours: 2,
        metadata: {
          ...sensorMeta,
          source: 'simulation' as const,
        },
      };
    });

    await EnergyGenerationRecord.insertMany(records);

    const total = records.reduce((sum, r) => sum + r.energyGenerated, 0);
    console.log(
      `[Energy Sim] ${timestamp.toISOString()} — Generated ${records.length} records (${total} Wh total) for units: ${onlineUnits.map((u) => u.serialNumber).join(', ')}`
    );
  } catch (error) {
    console.error(
      `[Energy Sim] ${new Date().toISOString()} — Failed to generate records:`,
      error
    );
  }
}

/**
 * Initialize the cron scheduler to generate energy records every 2 hours
 * for ALL registered solar units
 */
export const initializeEnergyCron = () => {
  const schedule = process.env.ENERGY_CRON_SCHEDULE || '0 */2 * * *';

  cron.schedule(schedule, async () => {
    await generateRecordsForAllUnits();
  });

  console.log(
    `[Energy Cron] Simulator initialized — Records will be generated for all ONLINE units at: ${schedule}`
  );
};
