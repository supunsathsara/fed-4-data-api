import express from "express";
import { deviceAuthMiddleware } from "./middlewares/device-auth-middleware";
import { ingestReading, ingestBatch } from "../application/ingest";

const ingestRouter = express.Router();

/**
 * IoT Data Ingestion Routes
 *
 * These are the endpoints a real IoT device talks to.
 * All routes require device authentication via X-API-Key header.
 *
 * POST /api/ingest         — Single reading
 * POST /api/ingest/batch   — Batch upload (buffered readings)
 */

ingestRouter.post("/", deviceAuthMiddleware, ingestReading);
ingestRouter.post("/batch", deviceAuthMiddleware, ingestBatch);

export default ingestRouter;
