import express from "express";
import {
  registerSolarUnit,
  listSolarUnits,
  getSolarUnit,
  updateSolarUnitStatus,
  rotateApiKey,
} from "../application/solar-unit";

const solarUnitRouter = express.Router();

/**
 * Solar Unit Management Routes
 *
 * These endpoints manage the lifecycle of solar units in the Data API.
 * They are called by the backend service or admin tools — NOT by IoT devices.
 *
 * In production, these would be protected by service-to-service auth
 * (e.g., a shared secret or mTLS between backend ↔ data-api).
 *
 * POST   /api/solar-units/register              — Register a new unit, get device API key
 * GET    /api/solar-units                        — List all registered units
 * GET    /api/solar-units/:serialNumber          — Get unit details
 * PATCH  /api/solar-units/:serialNumber/status   — Update unit status
 * POST   /api/solar-units/:serialNumber/rotate-key — Rotate device API key
 */

solarUnitRouter.post("/register", registerSolarUnit);
solarUnitRouter.get("/", listSolarUnits);
solarUnitRouter.get("/:serialNumber", getSolarUnit);
solarUnitRouter.patch("/:serialNumber/status", updateSolarUnitStatus);
solarUnitRouter.post("/:serialNumber/rotate-key", rotateApiKey);

export default solarUnitRouter;
