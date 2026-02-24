import mongoose from "mongoose";

const solarUnitSchema = new mongoose.Schema(
  {
    serialNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
    },
    capacity: {
      type: Number,
      required: true,
      min: 1,
    },
    location: {
      latitude: { type: Number, required: true },
      longitude: { type: Number, required: true },
      timezone: { type: String, default: "UTC" },
    },
    status: {
      type: String,
      required: true,
      enum: ["ONLINE", "OFFLINE", "MAINTENANCE"],
      default: "ONLINE",
    },
    apiKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    lastHeartbeat: {
      type: Date,
      default: null,
    },
    metadata: {
      panelType: { type: String, default: "monocrystalline" },
      inverterModel: { type: String, default: null },
      tiltAngle: { type: Number, default: 30 },
      azimuth: { type: Number, default: 180 },
    },
  },
  { timestamps: true }
);

export const SolarUnit = mongoose.model("SolarUnit", solarUnitSchema);
