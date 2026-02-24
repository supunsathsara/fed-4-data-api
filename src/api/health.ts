import express from "express";
import { EnergyGenerationRecord } from "../infrastructure/entities/EnergyGenerationRecord";
import { SolarUnit } from "../infrastructure/entities/SolarUnit";

const healthRouter = express.Router();

/**
 * Health & Status Endpoints
 *
 * GET /api/health         — Basic health check (for load balancers, uptime monitors)
 * GET /api/health/status  — Detailed system status (unit count, record count, last reading)
 */

healthRouter.get("/", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "solarpulse-data-api",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

healthRouter.get("/status", async (_req, res, next) => {
  try {
    const [unitCount, recordCount, onlineCount, lastRecord] = await Promise.all([
      SolarUnit.countDocuments(),
      EnergyGenerationRecord.countDocuments(),
      SolarUnit.countDocuments({ status: "ONLINE" }),
      EnergyGenerationRecord.findOne().sort({ timestamp: -1 }).lean(),
    ]);

    // Check which units have heartbeats within last 10 minutes
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recentlyActiveCount = await SolarUnit.countDocuments({
      lastHeartbeat: { $gte: tenMinutesAgo },
    });

    res.status(200).json({
      status: "ok",
      service: "solarpulse-data-api",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: {
        totalUnits: unitCount,
        onlineUnits: onlineCount,
        recentlyActiveDevices: recentlyActiveCount,
        totalRecords: recordCount,
        lastReading: lastRecord
          ? {
              serialNumber: (lastRecord as any).serialNumber,
              energyGenerated: (lastRecord as any).energyGenerated,
              timestamp: (lastRecord as any).timestamp,
            }
          : null,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default healthRouter;
