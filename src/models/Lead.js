const mongoose = require("mongoose");
const { LEAD_STATUS_KEYS, LEAD_STATUS_DEFAULT } = require("../constants/leadStatuses");

const leadSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      default: "",
      trim: true,
    },
    firstMessage: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: LEAD_STATUS_KEYS,
      default: LEAD_STATUS_DEFAULT,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

module.exports = mongoose.model("Lead", leadSchema);
