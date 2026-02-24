import mongoose from "mongoose";

const energyGenerationRecordSchema = new mongoose.Schema({
  serialNumber: {
    type: String,
    required: true,
    index: true,
  },
  energyGenerated: {
    type: Number,
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true,
  },
  intervalHours: {
    type: Number,
    default: 2,
    min: 0.1,
    max: 24,
  },
  // Optional metadata from real sensor hardware
  metadata: {
    voltage: { type: Number, default: null },
    current: { type: Number, default: null },
    temperature: { type: Number, default: null },   // Panel temp (°C)
    irradiance: { type: Number, default: null },     // Solar irradiance (W/m²)
    source: {
      type: String,
      enum: ["device", "device_batch", "simulation", "seed"],
      default: "simulation",
    },
  },
});

export const EnergyGenerationRecord = mongoose.model(
  "EnergyGenerationRecord",
  energyGenerationRecordSchema
);
