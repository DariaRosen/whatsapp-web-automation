const mongoose = require("mongoose");
const { LEAD_STATUS_KEYS, LEAD_STATUS_DEFAULT } = require("../constants/leadStatuses");
const { SERVICE_TYPE_KEYS } = require("../constants/serviceTypes");

const leadSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
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
    notes: {
      type: String,
      default: "",
      trim: true,
      maxlength: 8000,
    },
    serviceTypes: {
      type: [
        {
          type: String,
          enum: SERVICE_TYPE_KEYS,
        },
      ],
      default: [],
    },
    /** When set, lead is hidden from dashboard and WhatsApp will not re-create this phone. */
    removedAt: {
      type: Date,
      default: null,
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

// Unique phone among active (non-removed) leads only
leadSchema.index(
  { phone: 1 },
  {
    unique: true,
    partialFilterExpression: { removedAt: null },
  }
);

module.exports = mongoose.model("Lead", leadSchema);
