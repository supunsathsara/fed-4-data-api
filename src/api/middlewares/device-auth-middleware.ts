import { NextFunction, Request, Response } from "express";
import { SolarUnit } from "../../infrastructure/entities/SolarUnit";

/**
 * API Key Authentication Middleware for IoT Devices
 *
 * IoT devices authenticate by sending their API key in the header:
 *   X-API-Key: <device-api-key>
 *
 * This middleware:
 * 1. Extracts the API key from the request header
 * 2. Looks up the registered solar unit by that key
 * 3. Attaches the solar unit to `req.solarUnit` for downstream handlers
 * 4. Updates the unit's lastHeartbeat timestamp
 *
 * In production, this would use:
 * - An ESP32 / Raspberry Pi with a hard-coded API key
 * - TLS (HTTPS) to encrypt the key in transit
 * - Rate limiting per key to prevent abuse
 * - Key rotation policies
 */
export const deviceAuthMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const apiKey = req.headers["x-api-key"] as string;

    if (!apiKey) {
      return res.status(401).json({
        error: "MISSING_API_KEY",
        message: "X-API-Key header is required. Each IoT device is issued a unique API key upon registration.",
      });
    }

    const solarUnit = await SolarUnit.findOne({ apiKey });

    if (!solarUnit) {
      return res.status(403).json({
        error: "INVALID_API_KEY",
        message: "The provided API key does not match any registered device.",
      });
    }

    if (solarUnit.status === "OFFLINE") {
      return res.status(403).json({
        error: "DEVICE_OFFLINE",
        message: "This device has been marked offline. Contact an administrator.",
      });
    }

    // Update heartbeat
    solarUnit.lastHeartbeat = new Date();
    await solarUnit.save();

    // Attach unit to request for downstream handlers
    (req as any).solarUnit = solarUnit;

    next();
  } catch (error) {
    next(error);
  }
};
