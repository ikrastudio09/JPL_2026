/**
 * Player creation — the SAME document mapping and defaults used by the original
 * POST /api/register handler:
 *   status: "pending", playerCategory: "Undefined", playerPool: 0
 * `new Player(...).save()` is used so the existing pre-save hook assigns playerID
 * from PlayerCounter exactly as before.
 */
import Player from "../../models/Player";
import { calculateAge } from "../../utils/apiHelpers";

/**
 * @param {object} reg      validated registration data (from parseAndValidateRegistration)
 * @param {object} assets   { playerPhoto: {url, public_id}, aadhaarFront, aadhaarBack }
 * @param {object} payment  Razorpay payment subdocument
 */
export async function createPlayerFromRegistration(reg, assets, payment) {
  const player = new Player({
    playerName: reg.name,
    playerPhone: reg.mobile,
    dateOfBirth: new Date(reg.dateOfBirth),
    bloodGroup: reg.bloodGroup,
    fatherName: reg.fatherName,
    profession: reg.profession,
    professionOther: reg.profession === "Other" ? reg.professionOther : undefined,
    playingStyle: reg.playingStyle,
    playerType: reg.role,
    previousTeam: reg.previousTeam || undefined,
    tShirtSize: reg.tShirtSize,
    tShirtNumber: reg.tShirtNumber,
    tShirtName: reg.tShirtName,
    playerPhoto: assets.playerPhoto,
    // Existing unique transactionId field now carries the verified Razorpay payment ID
    transactionId: payment.razorpayPaymentId,
    playerAddress: [
      {
        AddressLine1: reg.addressLine1,
        AddressLine2: reg.addressLine2 || undefined,
        City: reg.city,
        State: reg.state,
        PinCode: reg.pinCode,
        Country: reg.country || "India",
      },
    ],
    aadhaarFrontImage: assets.aadhaarFront,
    aadhaarBackImage: assets.aadhaarBack,
    payment,
    // Existing defaults — unchanged
    status: "pending",
    playerCategory: "Undefined",
    playerPool: 0,
  });

  await player.save();
  return player;
}

/** Same success payload shape the original /api/register returned (no Cloudinary ids). */
export function toRegistrationSuccess(player) {
  return {
    id: player._id,
    playerID: player.playerID,
    name: player.playerName,
    mobile: player.playerPhone,
    dateOfBirth: player.dateOfBirth,
    age: calculateAge(player.dateOfBirth),
    bloodGroup: player.bloodGroup,
    profession: player.profession,
    professionOther: player.professionOther,
    playerPhoto: player.playerPhoto?.url,
    playingStyle: player.playingStyle,
    role: player.playerType,
    tShirtSize: player.tShirtSize,
    tShirtNumber: player.tShirtNumber,
    tShirtName: player.tShirtName,
    transactionId: player.transactionId,
    paymentId: player.payment?.razorpayPaymentId,
    status: player.status,
    createdAt: player.createdAt,
  };
}
