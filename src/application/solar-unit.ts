import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { SolarUnit } from "../infrastructure/entities/SolarUnit";

/**
 * Solar Unit Registration & Management
 *
 * These endpoints are called by the backend service (admin-facing)
 * to register new solar units and manage their lifecycle in the Data API.
 *
 * When a solar unit is created in the backend, it should also be registered
 * here so the Data API knows about it and can:
 * - Accept IoT readings for that serial number
 * - Issue an API key for the physical device
 * - Simulate data for it in dev/demo mode
 */

// ── DTOs ───────────────────────────────────────────────────────

const RegisterUnitDto = z.object({
  serialNumber: z.string().min(1),
  name: z.string().min(1),
  capacity: z.number().min(1),
  location: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    timezone: z.string().optional().default("UTC"),
  }),
  metadata: z
    .object({
      panelType: z.string().optional(),
      inverterModel: z.string().optional(),
      tiltAngle: z.number().optional(),
      azimuth: z.number().optional(),
    })
    .optional(),
});

const UpdateUnitStatusDto = z.object({
  status: z.enum(["ONLINE", "OFFLINE", "MAINTENANCE"]),
});

// ── Helpers ────────────────────────────────────────────────────

/**
 * Generate a secure API key for a device
 * Format: sp_dev_<32 random hex chars>
 *
 * In production:
 * - This key is flashed into the device's firmware or stored in NVS (ESP32) / env file (RPi)
 * - It should be stored hashed in the DB (we store plaintext here for demo simplicity)
 * - Keys should be rotatable via a rotate endpoint
 */
function generateApiKey(): string {
  const random = crypto.randomBytes(16).toString("hex");
  return `sp_dev_${random}`;
}

// ── Handlers ───────────────────────────────────────────────────

/**
 * POST /api/solar-units/register
 * Register a new solar unit and get its device API key
 */
export const registerSolarUnit = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = RegisterUnitDto.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        details: result.error.flatten().fieldErrors,
      });
    }

    const data = result.data;

    // Check if serial number already exists
    const existing = await SolarUnit.findOne({ serialNumber: data.serialNumber });
    if (existing) {
      return res.status(409).json({
        error: "DUPLICATE_SERIAL",
        message: `Unit ${data.serialNumber} is already registered`,
        apiKey: existing.apiKey, // Return existing key (in production, DON'T do this)
      });
    }

    const apiKey = generateApiKey();

    const unit = await SolarUnit.create({
      serialNumber: data.serialNumber,
      name: data.name,
      capacity: data.capacity,
      location: data.location,
      metadata: data.metadata || {},
      apiKey,
      status: "ONLINE",
    });

    res.status(201).json({
      id: unit._id,
      serialNumber: unit.serialNumber,
      name: unit.name,
      apiKey, // Return the API key ONCE — device must store it
      status: unit.status,
      message: "Unit registered. Store the API key securely — it won't be shown again.",
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/solar-units
 * List all registered units (for backend sync service)
 */
export const listSolarUnits = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const units = await SolarUnit.find({}, "-apiKey"); // Never expose API keys in list
    res.status(200).json(units);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/solar-units/:serialNumber
 * Get a single unit's details
 */
export const getSolarUnit = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { serialNumber } = req.params;
    const unit = await SolarUnit.findOne({ serialNumber }, "-apiKey");

    if (!unit) {
      return res.status(404).json({
        error: "NOT_FOUND",
        message: `Unit ${serialNumber} not found`,
      });
    }

    res.status(200).json(unit);
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/solar-units/:serialNumber/status
 * Update a unit's status (ONLINE / OFFLINE / MAINTENANCE)
 */
export const updateSolarUnitStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { serialNumber } = req.params;
    const result = UpdateUnitStatusDto.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        details: result.error.flatten().fieldErrors,
      });
    }

    const unit = await SolarUnit.findOneAndUpdate(
      { serialNumber },
      { status: result.data.status },
      { new: true, projection: "-apiKey" }
    );

    if (!unit) {
      return res.status(404).json({
        error: "NOT_FOUND",
        message: `Unit ${serialNumber} not found`,
      });
    }

    res.status(200).json(unit);
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/solar-units/:serialNumber/rotate-key
 * Rotate a device's API key (invalidates the old one)
 */
export const rotateApiKey = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { serialNumber } = req.params;
    const newKey = generateApiKey();

    const unit = await SolarUnit.findOneAndUpdate(
      { serialNumber },
      { apiKey: newKey },
      { new: true }
    );

    if (!unit) {
      return res.status(404).json({
        error: "NOT_FOUND",
        message: `Unit ${serialNumber} not found`,
      });
    }

    res.status(200).json({
      serialNumber: unit.serialNumber,
      apiKey: newKey,
      message: "API key rotated. Update the device firmware with the new key.",
    });
  } catch (error) {
    next(error);
  }
};
