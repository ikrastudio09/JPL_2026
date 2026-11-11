/**
 * Registration field validation — extracted VERBATIM from the original
 * POST /api/register handler so the rules and messages stay identical.
 *
 * Removed (old QR workflow only): transactionId and paymentScreenshot checks.
 * Payment is now proven by a server-verified Razorpay payment instead.
 */
import {
  validateRequiredFields,
  validateMobile,
  validateDate,
  validateUploadedFile,
} from "../../utils/apiHelpers";
import {
  BLOOD_GROUPS,
  PROFESSIONS,
  PLAYER_ROLES,
  PLAYING_STYLES,
  CLOTHING_SIZES,
  PREVIOUS_TEAMS,
  TSHIRT_NUMBER_MIN,
  TSHIRT_NUMBER_MAX,
  TSHIRT_NAME_MAX_LENGTH,
  MAX_IMAGE_SIZE_BYTES,
} from "../../constants/playerOptions";

const fail = (message, status = 400) => ({ error: { message, status } });

/**
 * @param {FormData} formData
 * @returns {{ error?: {message, status}, data?: object, playerPhoto?: File }}
 */
export function parseAndValidateRegistration(formData) {
  // Extract text fields
  const name = (formData.get("name") || "").toString().trim();
  const mobile = (formData.get("mobile") || "").toString().trim();
  const dateOfBirth = (formData.get("dateOfBirth") || "").toString().trim();
  const bloodGroup = (formData.get("bloodGroup") || "").toString().trim();
  const fatherName = (formData.get("fatherName") || "").toString().trim();
  const profession = (formData.get("profession") || "").toString().trim();
  const professionOtherRaw = (formData.get("professionOther") || "").toString().trim();
  const previousTeam = (formData.get("previousTeam") || "").toString().trim();
  const role = (formData.get("role") || "").toString().trim();
  const tShirtSize = (formData.get("tShirtSize") || "").toString().trim();
  const tShirtNumberRaw = (formData.get("tShirtNumber") || "").toString().trim();
  const tShirtName = (formData.get("tShirtName") || "").toString().trim().toUpperCase();

  // Address fields matching AddressSchema
  const addressLine1 = (formData.get("addressLine1") || "").toString().trim();
  const addressLine2 = (formData.get("addressLine2") || "").toString().trim();
  const city = (formData.get("city") || "").toString().trim();
  const state = (formData.get("state") || "").toString().trim();
  const pinCode = (formData.get("pinCode") || "").toString().trim();
  const country = (formData.get("country") || "India").toString().trim();

  // Parse playingStyle
  let playingStyle = [];
  const playingStyleRaw = formData.get("playingStyle");
  if (playingStyleRaw) {
    try {
      playingStyle = typeof playingStyleRaw === "string" ? JSON.parse(playingStyleRaw) : playingStyleRaw;
    } catch {
      return fail("Invalid playing style selection format.");
    }
  }

  const playerPhoto = formData.get("playerPhoto");

  // Validate Required Fields
  const requiredCheck = validateRequiredFields(
    {
      name,
      mobile,
      dateOfBirth,
      bloodGroup,
      fatherName,
      profession,
      role,
      tShirtSize,
      tShirtNumber: tShirtNumberRaw,
      tShirtName,
      addressLine1,
      city,
      state,
      pinCode,
    },
    [
      "name",
      "mobile",
      "dateOfBirth",
      "bloodGroup",
      "fatherName",
      "profession",
      "role",
      "tShirtSize",
      "tShirtNumber",
      "tShirtName",
      "addressLine1",
      "city",
      "state",
      "pinCode",
    ],
  );
  if (requiredCheck) return fail(requiredCheck);

  // Name validations
  if (name.length < 2 || name.length > 100) {
    return fail("Full name must be between 2 and 100 characters.");
  }
  if (fatherName.length < 2 || fatherName.length > 100) {
    return fail("Father's name must be between 2 and 100 characters.");
  }
  // Mobile validation
  if (!validateMobile(mobile)) {
    return fail("Invalid Indian mobile number. Must be 10 digits starting with 6, 7, 8, or 9.");
  }
  // DOB validation (required, not future)
  const dobError = validateDate(dateOfBirth, { required: true, allowFuture: false, fieldName: "Date of Birth" });
  if (dobError) return fail(dobError);

  // Blood group validation
  if (!BLOOD_GROUPS.includes(bloodGroup)) {
    return fail(`Invalid blood group. Must be one of: ${BLOOD_GROUPS.join(", ")}`);
  }

  // Profession validation
  if (!PROFESSIONS.includes(profession)) {
    return fail("Please select a valid profession from the predefined options.");
  }

  // Conditional professionOther validation
  let professionOther = "";
  if (profession === "Other") {
    if (!professionOtherRaw) {
      return fail("Please specify your profession when 'Other' is selected.");
    }
    if (professionOtherRaw.length > 100) {
      return fail("Custom profession cannot exceed 100 characters.");
    }
    professionOther = professionOtherRaw;
  }

  // Role validation
  if (!PLAYER_ROLES.includes(role)) {
    return fail(`Invalid role. Must be one of: ${PLAYER_ROLES.join(", ")}`);
  }

  // Previous team validation (optional, but if provided must be one of PREVIOUS_TEAMS)
  if (previousTeam && !PREVIOUS_TEAMS.includes(previousTeam)) {
    return fail("Please select a valid previous team from the options.");
  }

  // Playing styles validation (1 to 2 allowed)
  if (!Array.isArray(playingStyle) || playingStyle.length < 1 || playingStyle.length > 2) {
    return fail("Select 1 to 2 playing styles.");
  }
  for (const style of playingStyle) {
    if (!PLAYING_STYLES.includes(style)) {
      return fail(`Invalid playing style: "${style}".`);
    }
  }

  // Clothing size validation
  if (!CLOTHING_SIZES.includes(tShirtSize)) {
    return fail(`Invalid T-shirt size. Must be one of: ${CLOTHING_SIZES.join(", ")}`);
  }

  // T-shirt number validation
  const parsedNumber = Number(tShirtNumberRaw);
  if (!Number.isInteger(parsedNumber) || parsedNumber < TSHIRT_NUMBER_MIN || parsedNumber > TSHIRT_NUMBER_MAX) {
    return fail(`T-shirt number must be a whole number between ${TSHIRT_NUMBER_MIN} and ${TSHIRT_NUMBER_MAX}.`);
  }

  // T-shirt name validation
  if (!tShirtName || tShirtName.length > TSHIRT_NAME_MAX_LENGTH) {
    return fail(`T-shirt name is required and cannot exceed ${TSHIRT_NAME_MAX_LENGTH} characters.`);
  }

  // Player photo (unchanged rules)
  const photoError = validateUploadedFile(playerPhoto, "Player photo", {
    required: true,
    maxSizeBytes: MAX_IMAGE_SIZE_BYTES,
  });
  if (photoError) return fail(photoError);

  return {
    playerPhoto,
    data: {
      name,
      mobile,
      dateOfBirth,
      bloodGroup,
      fatherName,
      profession,
      professionOther,
      previousTeam,
      role,
      playingStyle,
      tShirtSize,
      tShirtNumber: parsedNumber,
      tShirtName,
      addressLine1,
      addressLine2,
      city,
      state,
      pinCode,
      country,
    },
  };
}
