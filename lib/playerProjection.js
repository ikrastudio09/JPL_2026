/**
 * Shared admin projection for Player documents.
 * Aadhaar image references are NEVER returned — only boolean presence flags.
 */
import { calculateAge } from "../utils/apiHelpers";

// Existing field list used by the admin APIs, plus Razorpay payment metadata.
export const ADMIN_PLAYER_FIELDS =
  "playerID playerName playerPhone dateOfBirth bloodGroup " +
  "fatherName profession professionOther previousTeam playerAddress " +
  "previousPoints previousPerformance " +
  "playerPhoto.url playingStyle playerType playerPool playerCategory " +
  "tShirtSize pantSize tShirtNumber tShirtName " +
  "paymentScreenshot.url transactionId status Age createdAt updatedAt " +
  "payment.provider payment.razorpayOrderId payment.razorpayPaymentId payment.amount " +
  "payment.currency payment.status payment.method payment.paidAt " +
  // Explicit inclusion overrides the schema's select:false; only used to compute the
  // hasAadhaar* flags and stripped by toAdminPlayer() before anything is returned.
  "aadhaarFrontImage.public_id aadhaarBackImage.public_id";

/** Convert a lean Player into the admin API shape (strips Aadhaar refs, adds flags). */
export function toAdminPlayer(raw) {
  if (!raw) return raw;
  const { aadhaarFrontImage, aadhaarBackImage, ...rest } = raw;
  return {
    ...rest,
    hasAadhaarFront: !!aadhaarFrontImage?.public_id,
    hasAadhaarBack: !!aadhaarBackImage?.public_id,
    calculatedAge: calculateAge(raw.dateOfBirth, raw.Age),
  };
}
