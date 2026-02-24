import cors from "cors";
import "dotenv/config";
import express from "express";
import energyGenerationRecordRouter from "./api/energy-generation-record";
import ingestRouter from "./api/ingest";
import solarUnitRouter from "./api/solar-unit";
import healthRouter from "./api/health";
import { globalErrorHandler } from "./api/middlewares/global-error-handling-middleware";
import { loggerMiddleware } from "./api/middlewares/logger-middleware";
import { connectDB } from "./infrastructure/db";
import { initializeEnergyCron } from "./infrastructure/energy-generation-cron";

const server = express();
server.use(cors());

server.use(loggerMiddleware);

server.use(express.json());

// ── Routes ────────────────────────────────────────────────────
// Health check (no auth)
server.use("/api/health", healthRouter);

// IoT device data ingestion (device API key auth via X-API-Key header)
server.use("/api/ingest", ingestRouter);

// Solar unit management (backend service calls)
server.use("/api/solar-units", solarUnitRouter);

// Energy generation records query (backend sync service)
server.use("/api/energy-generation-records", energyGenerationRecordRouter);

server.use(globalErrorHandler);

connectDB();
initializeEnergyCron();

const PORT = process.env.PORT || 8001;
server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  SolarPulse Data API running on port ${PORT}        ║`);
  console.log(`╠══════════════════════════════════════════════════╣`);
  console.log(`║  Health:    GET  /api/health                     ║`);
  console.log(`║  Ingest:    POST /api/ingest        (X-API-Key)  ║`);
  console.log(`║  Batch:     POST /api/ingest/batch  (X-API-Key)  ║`);
  console.log(`║  Units:     GET  /api/solar-units                ║`);
  console.log(`║  Records:   GET  /api/energy-generation-records  ║`);
  console.log(`╚══════════════════════════════════════════════════╝\n`);
});
