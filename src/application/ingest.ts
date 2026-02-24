import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { EnergyGenerationRecord } from "../infrastructure/entities/EnergyGenerationRecord";

/**
 * IoT Data Ingestion Endpoint
 *
 * This is the endpoint that a real IoT device (ESP32 / Raspberry Pi) would POST to.
 * The device sends energy readings periodically (e.g., every 15 min, 1 hour, etc.)
 *
 * ── Production Device Flow ──
 *
 * 1. Device reads current/voltage from the solar inverter via:
 *    - Modbus RTU/TCP (most commercial inverters)
 *    - CT clamp on the AC output
 *    - Direct ADC reading on a microcontroller
 *
 * 2. Device calculates energy (Wh) = Power (W) × time interval (h)
 *
 * 3. Device POSTs to this endpoint with its API key:
 *    POST /api/ingest
 *    X-API-Key: <device-api-key>
 *    Content-Type: application/json
 *    {
 *      "energyGenerated": 245.5,
 *      "timestamp": "2026-02-24T10:00:00Z",     // optional, defaults to server time
 *      "intervalHours": 2,                        // optional, defaults to 2
 *      "voltage": 240.1,                          // optional metadata
 *      "current": 8.5,                            // optional metadata
 *      "temperature": 45.2,                       // optional metadata — panel temp
 *      "irradiance": 850                          // optional metadata — W/m²
 *    }
 *
 * ── Recommended Hardware ──
 *
 * Option A: ESP32 + CT Clamp (Budget ~$15)
 *   - ESP32-WROOM-32 dev board ($5)
 *   - SCT-013 current transformer ($8)
 *   - Reads AC current, calculates power, POSTs via WiFi
 *   - Arduino / MicroPython firmware
 *   - Ideal for residential installations
 *
 * Option B: Raspberry Pi + Modbus (Budget ~$50)
 *   - Raspberry Pi Zero 2 W ($15)
 *   - RS485-to-USB adapter ($10)
 *   - Reads inverter registers via Modbus protocol
 *   - Python script with schedule library
 *   - Ideal for commercial inverters (SMA, Fronius, Huawei, etc.)
 *
 * Option C: Smart Inverter Direct API (~$0 extra)
 *   - Many modern inverters have built-in WiFi + cloud APIs
 *   - A server-side cron job polls the inverter's cloud API
 *   - Forwards data to this ingestion endpoint
 *   - Supported brands: Enphase, SolarEdge, Fronius, Huawei
 */

// Validation schema for incoming IoT readings
const IngestReadingDto = z.object({
  energyGenerated: z
    .number()
    .min(0, "Energy must be non-negative")
    .max(100000, "Reading exceeds reasonable max"),
  timestamp: z.string().datetime().optional(),
  intervalHours: z.number().min(0.1).max(24).optional().default(2),
  // Optional sensor metadata — useful for advanced diagnostics
  voltage: z.number().optional(),
  current: z.number().optional(),
  temperature: z.number().optional(),
  irradiance: z.number().optional(),
});

// Batch ingestion schema — for devices that buffer and send multiple readings at once
const IngestBatchDto = z.object({
  readings: z
    .array(IngestReadingDto)
    .min(1, "At least one reading required")
    .max(100, "Maximum 100 readings per batch"),
});

/**
 * POST /api/ingest
 * Single reading from an IoT device
 */
export const ingestReading = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const solarUnit = (req as any).solarUnit;
    const result = IngestReadingDto.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "Invalid reading data",
        details: result.error.flatten().fieldErrors,
      });
    }

    const data = result.data;

    const record = await EnergyGenerationRecord.create({
      serialNumber: solarUnit.serialNumber,
      energyGenerated: data.energyGenerated,
      timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
      intervalHours: data.intervalHours,
      metadata: {
        voltage: data.voltage,
        current: data.current,
        temperature: data.temperature,
        irradiance: data.irradiance,
        source: "device",
      },
    });

    res.status(201).json({
      status: "accepted",
      recordId: record._id,
      serialNumber: solarUnit.serialNumber,
      timestamp: record.timestamp,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/ingest/batch
 * Batch upload — for devices that buffer readings (e.g., intermittent connectivity)
 *
 * Use case: An ESP32 in a remote location with spotty WiFi stores readings
 * in flash memory and uploads them all when connectivity is restored.
 */
export const ingestBatch = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const solarUnit = (req as any).solarUnit;
    const result = IngestBatchDto.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "Invalid batch data",
        details: result.error.flatten().fieldErrors,
      });
    }

    const { readings } = result.data;

    const records = readings.map((r) => ({
      serialNumber: solarUnit.serialNumber,
      energyGenerated: r.energyGenerated,
      timestamp: r.timestamp ? new Date(r.timestamp) : new Date(),
      intervalHours: r.intervalHours,
      metadata: {
        voltage: r.voltage,
        current: r.current,
        temperature: r.temperature,
        irradiance: r.irradiance,
        source: "device_batch",
      },
    }));

    const inserted = await EnergyGenerationRecord.insertMany(records);

    res.status(201).json({
      status: "accepted",
      count: inserted.length,
      serialNumber: solarUnit.serialNumber,
    });
  } catch (error) {
    next(error);
  }
};
