/**
 * Player Registration Schema
 * Mongoose model for cricket tournament player registrations
 */
import mongoose from "mongoose";
import PlayerCounter from "./PlayerCounter";
import {
  BLOOD_GROUPS,
  PROFESSIONS,
  PLAYER_ROLES,
  PLAYING_STYLES,
  CLOTHING_SIZES,
  TSHIRT_NUMBER_MIN,
  TSHIRT_NUMBER_MAX,
} from "../constants/playerOptions";

const AddressSchema = new mongoose.Schema(
  {
    AddressLine1: {
      type: String,
      required: true,
    },
    AddressLine2: {
      type: String,
    },
    State: {
      type: String,
      required: true,
    },
    City: {
      type: String,
      required: true,
    },
    PinCode: {
      type: String,
      required: true,
    },
    Country: {
      type: String,
      default: "India",
    },
  },
  { _id: false },
);

const previousPerformanceSchema = new mongoose.Schema(
  {
    year: Number,
    matches: { type: Number, default: 0 },
    runs: { type: Number, default: 0 },
    wickets: { type: Number, default: 0 },
    fielding: { type: Number, default: 0 },
    mom: { type: Number, default: 0 },
    battingAvg: { type: Number, default: 0 },
    strikeRate: { type: Number, default: 0 },
    economy: { type: Number, default: 0 },
  },
  { _id: false },
);

// Private (Cloudinary "authenticated") document reference.
// No public URL is stored; admins view the image only via the authenticated proxy route.
const PrivateDocumentSchema = new mongoose.Schema(
  {
    public_id: { type: String, required: true },
    format: { type: String },
    bytes: { type: Number },
    delivery_type: { type: String, default: "authenticated" },
    uploadedAt: { type: Date },
  },
  { _id: false },
);

// Razorpay payment metadata (only present on registrations paid through Razorpay)
const PaymentSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ["razorpay"], required: true },
    razorpayOrderId: { type: String, required: true },
    razorpayPaymentId: { type: String, required: true },
    receipt: { type: String },
    amount: { type: Number, required: true }, // in paise
    currency: { type: String, default: "INR" },
    status: { type: String }, // Razorpay payment status, e.g. "captured"
    method: { type: String }, // upi | card | netbanking | wallet | ...
    paidAt: { type: Date },
    verifiedVia: { type: String, enum: ["checkout", "webhook", "reconciliation"] },
  },
  { _id: false },
);

// Legacy (QR/UPI) registrations always have a payment screenshot; Razorpay ones do not.
function requiresPaymentScreenshot() {
  return !(this.payment && this.payment.provider === "razorpay");
}

const PlayerSchema = new mongoose.Schema(
  {
    playerID: {
      type: Number,
      unique: true,
    },
    // Player's full name
    playerName: {
      type: String,
      required: [true, "Full name is required"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters"],
      maxlength: [100, "Name cannot exceed 100 characters"],
    },

    // Indian mobile number (10 digits)
    playerPhone: {
      type: String,
      required: [true, "Mobile number is required"],
      match: [/^[6-9]\d{9}$/, "Please enter a valid Indian mobile number"],
    },

    // Date of Birth
    dateOfBirth: {
      type: Date,
      required: [true, "Date of birth is required"],
    },

    // Blood Group
    bloodGroup: {
      type: String,
      required: [true, "Blood group is required"],
      enum: {
        values: BLOOD_GROUPS,
        message: "{VALUE} is not a valid blood group",
      },
    },

    playerAddress: {
      type: [AddressSchema],
      default: [],
    },

    fatherName: {
      type: String,
      required: [true, "Father's name is required"],
      trim: true,
      minlength: [2, "Father's name must be at least 2 characters"],
      maxlength: [100, "Father's name cannot exceed 100 characters"],
    },

    profession: {
      type: String,
      required: [true, "Profession is required"],
      enum: {
        values: PROFESSIONS,
        message: "{VALUE} is not a valid profession",
      },
    },

    professionOther: {
      type: String,
      trim: true,
      maxlength: [100, "Custom profession cannot exceed 100 characters"],
      validate: {
        validator: function (val) {
          if (this.profession === "Other") {
            return typeof val === "string" && val.trim().length > 0;
          }
          return true;
        },
        message: "Please specify your custom profession",
      },
    },

    // Historical Age field - preserved for backward compatibility
    Age: {
      type: mongoose.Schema.Types.Mixed,
    },

    // Player photo stored in Cloudinary
    playerPhoto: {
      url: {
        type: String,
        required: [true, "Player photo is required"],
      },
      public_id: {
        type: String,
        required: [true, "Player photo public ID is required"],
      },
    },

    // Playing styles (1 to 2 selections)
    playingStyle: {
      type: [String],
      required: [true, "At least one playing style is required"],
      enum: {
        values: PLAYING_STYLES,
        message: "{VALUE} is not a valid playing style",
      },
      validate: {
        validator: function (arr) {
          return Array.isArray(arr) && arr.length >= 1 && arr.length <= 2;
        },
        message: "Select 1 to 2 playing styles only",
      },
    },

    // Player role in the team
    playerType: {
      type: String,
      required: [true, "Player role is required"],
      enum: {
        values: PLAYER_ROLES,
        message: "{VALUE} is not a valid role",
      },
    },

    previousTeam: {
      type: String,
      trim: true,
    },

    previousPoints: {
      type: Number,
    },

    previousPerformance: [previousPerformanceSchema],

    tShirtSize: {
      type: String,
      required: [true, "T-shirt size is required"],
      enum: {
        values: CLOTHING_SIZES,
        message: "{VALUE} is not a valid clothing size",
      },
    },

    tShirtNumber: {
      type: Number,
      required: [true, "T-shirt number is required"],
      min: [
        TSHIRT_NUMBER_MIN,
        `T-shirt number cannot be less than ${TSHIRT_NUMBER_MIN}`,
      ],
      max: [
        TSHIRT_NUMBER_MAX,
        `T-shirt number cannot exceed ${TSHIRT_NUMBER_MAX}`,
      ],
      validate: {
        validator: Number.isInteger,
        message: "T-shirt number must be a whole integer",
      },
    },

    tShirtName: {
      type: String,
      required: [true, "T-shirt name is required"],
      trim: true,
      uppercase: true,
      maxlength: [20, "T-shirt name cannot exceed 20 characters"],
    },

    playerPool: {
      type: Number,
      default: 0,
    },

    playerCategory: {
      type: String,
      default: "Undefined",
    },

    // Payment screenshot stored in Cloudinary (legacy QR/UPI workflow; historical records)
    paymentScreenshot: {
      url: {
        type: String,
        required: [requiresPaymentScreenshot, "Payment screenshot is required"],
      },
      public_id: {
        type: String,
        required: [requiresPaymentScreenshot, "Payment screenshot public ID is required"],
      },
    },

    // Aadhaar card images (new registrations). Excluded from every query by default.
    aadhaarFrontImage: { type: PrivateDocumentSchema, select: false },
    aadhaarBackImage: { type: PrivateDocumentSchema, select: false },

    // Razorpay payment details (new registrations)
    payment: { type: PaymentSchema },

    // Unique transaction ID from payment
    transactionId: {
      type: String,
      required: [true, "Transaction ID is required"],
      unique: true,
      trim: true,
      uppercase: true,
    },

    // Registration status
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
  },
  {
    // Auto timestamps: createdAt & updatedAt
    timestamps: true,
  },
);

PlayerSchema.pre("save", async function (next) {
  if (this.isNew) {
    const counter = await PlayerCounter.findOneAndUpdate(
      { id: "playerID" },
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );
    this.playerID = counter.seq;
  }
  next();
});

// Indexes for faster queries
PlayerSchema.index({ playerPhone: 1 });
PlayerSchema.index({ status: 1 });
PlayerSchema.index({ createdAt: -1 });
PlayerSchema.index({ profession: 1 });
PlayerSchema.index({ tShirtNumber: 1 });

// Admin list sorts by { createdAt: -1, _id: -1 } (the _id tie-breaker keeps pagination stable
// when records share a timestamp, e.g. bulk imports). Without this index that sort becomes a
// collection scan + in-memory sort (verified with explain("executionStats"), see tests/perf.mjs).
// Filter-specific compound indexes were measured and NOT added: gains were ~1 ms at 5,000 players.
// (The older { createdAt: -1 } index is now a prefix of this one and could be dropped later.)
PlayerSchema.index({ createdAt: -1, _id: -1 });

// Razorpay idempotency guards: one registration per order and per payment.
// Partial indexes so historical documents without payment data are unaffected.
PlayerSchema.index(
  { "payment.razorpayOrderId": 1 },
  { unique: true, partialFilterExpression: { "payment.razorpayOrderId": { $type: "string" } } },
);
PlayerSchema.index(
  { "payment.razorpayPaymentId": 1 },
  { unique: true, partialFilterExpression: { "payment.razorpayPaymentId": { $type: "string" } } },
);

// Prevent model overwrite in development (hot reload)
const Player = mongoose.models.Player || mongoose.model("Player", PlayerSchema);

export default Player;
