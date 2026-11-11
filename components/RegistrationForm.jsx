"use client";

import { useState, useEffect, useRef } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import InputField from "./InputField";
import SelectField from "./SelectField";
import SearchableSelect from "./SearchableSelect";
import ImageUpload from "./ImageUpload";
import PlayingStyleSelector from "./PlayingStyleSelector";
import RoleSelector from "./RoleSelector";
import RazorpayPayment from "./RazorpayPayment";
import ReviewModal from "./ReviewModal";
import SuccessModal from "./SuccessModal";
import {
  BLOOD_GROUPS,
  PROFESSIONS,
  PLAYER_ROLES,
  CLOTHING_SIZES,
  PREVIOUS_TEAMS,
  TSHIRT_NUMBER_MIN,
  TSHIRT_NUMBER_MAX,
  TSHIRT_NAME_MAX_LENGTH,
  AADHAAR_MAX_IMAGE_SIZE_BYTES,
  AADHAAR_ALLOWED_TYPES,
  AADHAAR_ALLOWED_EXTENSIONS,
} from "../constants/playerOptions";
import { calculateAge } from "../utils/apiHelpers";

// Initial form state - all required and optional fields
const INITIAL_STATE = {
  name: "",
  mobile: "",
  dateOfBirth: "",
  bloodGroup: "",
  fatherName: "",
  profession: "",
  professionOther: "",
  previousTeam: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  pinCode: "",
  country: "India",
  playerPhoto: null,
  playingStyle: [],
  role: "",
  tShirtSize: "",
  tShirtNumber: "",
  tShirtName: "",
};

const INITIAL_ERRORS = {};

// Aadhaar upload state per side (front / back)
const EMPTY_UPLOAD = { file: null, preview: "", status: "idle", progress: 0, uploadId: "", error: "" };
const INITIAL_AADHAAR = { front: { ...EMPTY_UPLOAD }, back: { ...EMPTY_UPLOAD } };
const AADHAAR_FIELD = { front: "aadhaarFront", back: "aadhaarBack" };
const AADHAAR_LABEL = { front: "Aadhaar card front image", back: "Aadhaar card back image" };
const AADHAAR_MAX_MB = Math.round(AADHAAR_MAX_IMAGE_SIZE_BYTES / (1024 * 1024));

const RAZORPAY_CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";
const STATUS_POLL_INTERVAL_MS = 3000;
const STATUS_POLL_ATTEMPTS = 40; // ~2 minutes

let razorpayScriptPromise = null;
function loadRazorpayScript() {
  if (typeof window !== "undefined" && window.Razorpay) return Promise.resolve();
  if (!razorpayScriptPromise) {
    razorpayScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = RAZORPAY_CHECKOUT_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        razorpayScriptPromise = null;
        reject(new Error("Could not load the Razorpay payment window. Check your internet connection and try again."));
      };
      document.body.appendChild(script);
    });
  }
  return razorpayScriptPromise;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function discardAadhaarUpload(uploadId) {
  if (!uploadId) return;
  fetch(`/api/registration/aadhaar-upload?uploadId=${encodeURIComponent(uploadId)}`, {
    method: "DELETE",
    keepalive: true,
  }).catch(() => {});
}

/**
 * Main Registration Form
 * Client component — handles form state, previews, comprehensive validation & submission
 */
export default function RegistrationForm({ registrationFee = 1500 }) {
  const [form, setForm] = useState(INITIAL_STATE);
  const [errors, setErrors] = useState(INITIAL_ERRORS);
  const [successData, setSuccessData] = useState(null);

  // Object URL preview state to prevent memory leaks
  const [photoPreview, setPhotoPreview] = useState("");

  // Aadhaar uploads (uploaded independently with progress)
  const [aadhaar, setAadhaar] = useState(INITIAL_AADHAAR);
  const aadhaarFileRef = useRef({ front: null, back: null });
  const aadhaarAbortRef = useRef({ front: null, back: null });

  // Payment flow
  const [showReview, setShowReview] = useState(false);
  const [paymentPhase, setPaymentPhase] = useState("idle"); // idle | creating | checkout | verifying | pending
  const [paymentNotice, setPaymentNotice] = useState(null);
  const pendingOrderRef = useRef(null); // reused on retry when the details are unchanged
  const paymentBusyRef = useRef(false);

  // Revoke object URLs on unmount
  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  // Warn before leaving while a payment is in progress / being verified
  useEffect(() => {
    if (!["checkout", "verifying"].includes(paymentPhase)) return;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [paymentPhase]);

  // --- Field Handlers ---
  const handleChange = (field) => (e) => {
    let val = e.target.value;
    if (field === "tShirtName") {
      val = val.toUpperCase().slice(0, TSHIRT_NAME_MAX_LENGTH);
    }
    setForm((prev) => ({ ...prev, [field]: val }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: "" }));
  };

  const handleSelectChange = (field) => (e) => {
    const val = typeof e === "string" ? e : e.target.value;
    setForm((prev) => {
      const next = { ...prev, [field]: val };
      // When profession changes away from "Other", clear professionOther and its error
      if (field === "profession" && val !== "Other") {
        next.professionOther = "";
      }
      return next;
    });

    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev, [field]: "" };
        if (field === "profession") next.professionOther = "";
        return next;
      });
    }
  };

  const handleImageSelect = (field) => (file, errorMsg) => {
    if (field === "playerPhoto") {
      if (photoPreview) {
        URL.revokeObjectURL(photoPreview);
        setPhotoPreview("");
      }
      if (file) {
        const url = URL.createObjectURL(file);
        setPhotoPreview(url);
      }
    }

    setForm((prev) => ({ ...prev, [field]: file || null }));
    setErrors((prev) => ({ ...prev, [field]: errorMsg || "" }));
  };

  // --- Aadhaar upload handlers ---
  const uploadAadhaar = async (side, file) => {
    const field = AADHAAR_FIELD[side];
    const controller = new AbortController();
    aadhaarAbortRef.current[side] = controller;
    const isCurrent = () => aadhaarFileRef.current[side] === file;

    const fd = new FormData();
    fd.append("side", side);
    fd.append("file", file);

    try {
      const res = await axios.post("/api/registration/aadhaar-upload", fd, {
        signal: controller.signal,
        onUploadProgress: (e) => {
          if (!e.total || !isCurrent()) return;
          const pct = Math.min(99, Math.round((e.loaded * 100) / e.total));
          setAadhaar((prev) => ({ ...prev, [side]: { ...prev[side], progress: pct } }));
        },
      });
      const uploadId = res.data?.data?.uploadId;
      if (!isCurrent()) {
        discardAadhaarUpload(uploadId); // replaced while uploading
        return;
      }
      setAadhaar((prev) => ({
        ...prev,
        [side]: { ...prev[side], status: "done", progress: 100, uploadId, error: "" },
      }));
    } catch (err) {
      if (axios.isCancel(err) || !isCurrent()) return;
      const msg = err.response?.data?.message || `${AADHAAR_LABEL[side]} upload failed. Please try again.`;
      setAadhaar((prev) => ({ ...prev, [side]: { ...prev[side], status: "error", error: msg } }));
      setErrors((prev) => ({ ...prev, [field]: msg }));
    }
  };

  const handleAadhaarSelect = (side) => (file, errorMsg) => {
    const field = AADHAAR_FIELD[side];
    const previous = aadhaar[side];

    // Cancel any in-flight upload and discard the previous image
    aadhaarAbortRef.current[side]?.abort();
    if (previous.preview) URL.revokeObjectURL(previous.preview);
    if (previous.uploadId) discardAadhaarUpload(previous.uploadId);
    aadhaarFileRef.current[side] = file || null;

    if (!file) {
      setAadhaar((prev) => ({ ...prev, [side]: { ...EMPTY_UPLOAD } }));
      setErrors((prev) => ({ ...prev, [field]: errorMsg || "" }));
      return;
    }

    setAadhaar((prev) => ({
      ...prev,
      [side]: { ...EMPTY_UPLOAD, file, preview: URL.createObjectURL(file), status: "uploading" },
    }));
    setErrors((prev) => ({ ...prev, [field]: "" }));
    uploadAadhaar(side, file);
  };

  const handlePlayingStyleChange = (styles) => {
    setForm((prev) => ({ ...prev, playingStyle: styles }));
    if (errors.playingStyle) {
      setErrors((prev) => ({ ...prev, playingStyle: "" }));
    }
  };

  const handleRoleChange = (role) => {
    setForm((prev) => ({ ...prev, role }));
    if (errors.role) setErrors((prev) => ({ ...prev, role: "" }));
  };

  // --- Dynamic Age Display from DOB ---
  const computedAge = calculateAge(form.dateOfBirth);

  // --- Comprehensive Frontend Validation ---
  const validate = () => {
    const newErrors = {};

    // Full Name
    if (!form.name.trim()) {
      newErrors.name = "Full name is required";
    } else if (form.name.trim().length < 2) {
      newErrors.name = "Name must be at least 2 characters";
    } else if (form.name.trim().length > 100) {
      newErrors.name = "Name cannot exceed 100 characters";
    }

    // Mobile
    if (!form.mobile.trim()) {
      newErrors.mobile = "Mobile number is required";
    } else if (!/^[6-9]\d{9}$/.test(form.mobile.trim())) {
      newErrors.mobile =
        "Enter a valid 10-digit Indian mobile number (starts with 6-9)";
    }

    // Date of Birth
    if (!form.dateOfBirth) {
      newErrors.dateOfBirth = "Date of birth is required";
    } else {
      const dobDate = new Date(form.dateOfBirth);
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      if (isNaN(dobDate.getTime())) {
        newErrors.dateOfBirth = "Enter a valid date of birth";
      } else if (dobDate > today) {
        newErrors.dateOfBirth = "Date of birth cannot be in the future";
      }
    }

    // Blood Group
    if (!form.bloodGroup) {
      newErrors.bloodGroup = "Blood group is required";
    } else if (!BLOOD_GROUPS.includes(form.bloodGroup)) {
      newErrors.bloodGroup = "Select a valid blood group";
    }

    // Father's Name
    if (!form.fatherName.trim()) {
      newErrors.fatherName = "Father's full name is required";
    } else if (form.fatherName.trim().length < 2) {
      newErrors.fatherName = "Father's name must be at least 2 characters";
    } else if (form.fatherName.trim().length > 100) {
      newErrors.fatherName = "Father's name cannot exceed 100 characters";
    }

    // Profession
    if (!form.profession) {
      newErrors.profession = "Profession selection is mandatory";
    } else if (!PROFESSIONS.includes(form.profession)) {
      newErrors.profession =
        "Select a valid profession from predefined options";
    }

    // Conditional Other Profession
    if (form.profession === "Other") {
      if (!form.professionOther.trim()) {
        newErrors.professionOther = "Please specify your profession";
      } else if (form.professionOther.trim().length > 100) {
        newErrors.professionOther =
          "Custom profession cannot exceed 100 characters";
      }
    }

    // Previous Team (optional dropdown, must be from PREVIOUS_TEAMS if selected)
    if (form.previousTeam && !PREVIOUS_TEAMS.includes(form.previousTeam)) {
      newErrors.previousTeam = "Please select a valid previous team";
    }

    // Address Details (AddressSchema)
    if (!form.addressLine1.trim()) {
      newErrors.addressLine1 = "Address Line 1 is required";
    }

    if (!form.city.trim()) {
      newErrors.city = "City is required";
    }

    if (!form.state.trim()) {
      newErrors.state = "State is required";
    }

    if (!form.pinCode.trim()) {
      newErrors.pinCode = "Pin Code is required";
    } else if (!/^\d{6}$/.test(form.pinCode.trim())) {
      newErrors.pinCode = "Enter a valid 6-digit Indian PIN Code";
    }

    // Player Photo
    if (!form.playerPhoto) {
      newErrors.playerPhoto = "Player photo is required";
    }

    // Playing Style (1 to 2)
    if (!form.playingStyle || form.playingStyle.length === 0) {
      newErrors.playingStyle = "Select at least 1 playing style";
    } else if (form.playingStyle.length > 2) {
      newErrors.playingStyle = "Maximum 2 playing styles allowed";
    }

    // Player Role
    if (!form.role) {
      newErrors.role = "Player role is required";
    } else if (!PLAYER_ROLES.includes(form.role)) {
      newErrors.role = "Select a valid player role";
    }

    // Aadhaar Card (front & back) — both mandatory and must have finished uploading
    for (const side of ["front", "back"]) {
      const a = aadhaar[side];
      const field = AADHAAR_FIELD[side];
      const label = AADHAAR_LABEL[side];
      if (!a.file) {
        newErrors[field] = `${label.charAt(0).toUpperCase()}${label.slice(1)} is required`;
      } else if (a.status === "uploading") {
        newErrors[field] = `Please wait — ${label} is still uploading`;
      } else if (a.status !== "done" || !a.uploadId) {
        newErrors[field] = a.error || `${label} upload failed. Please re-upload`;
      }
    }

    // Merchandise: T-Shirt Size
    if (!form.tShirtSize) {
      newErrors.tShirtSize = "T-shirt size is required";
    } else if (!CLOTHING_SIZES.includes(form.tShirtSize)) {
      newErrors.tShirtSize = "Select a valid T-shirt size";
    }

    // Merchandise: T-Shirt Number (0-99)
    if (
      form.tShirtNumber === "" ||
      form.tShirtNumber === null ||
      form.tShirtNumber === undefined
    ) {
      newErrors.tShirtNumber = "T-shirt number is required";
    } else {
      const num = Number(form.tShirtNumber);
      if (!Number.isInteger(num)) {
        newErrors.tShirtNumber = "T-shirt number must be a whole number";
      } else if (num < TSHIRT_NUMBER_MIN || num > TSHIRT_NUMBER_MAX) {
        newErrors.tShirtNumber = `T-shirt number must be between ${TSHIRT_NUMBER_MIN} and ${TSHIRT_NUMBER_MAX}`;
      }
    }

    // Merchandise: T-Shirt Name
    if (!form.tShirtName.trim()) {
      newErrors.tShirtName = "T-shirt name is required";
    } else if (form.tShirtName.trim().length > TSHIRT_NAME_MAX_LENGTH) {
      newErrors.tShirtName = `T-shirt name cannot exceed ${TSHIRT_NAME_MAX_LENGTH} characters`;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // --- Submit Handler: validate, then show the review step ---
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (paymentBusyRef.current) return;

    if (paymentPhase === "pending") {
      // Payment response received earlier but confirmation is still outstanding
      const order = pendingOrderRef.current;
      if (order) {
        paymentBusyRef.current = true;
        await pollOrderStatus(order);
      }
      return;
    }

    if (!validate()) {
      toast.error(
        "Please fill all required fields correctly before submitting.",
      );
      // Smoothly scroll to the first element with an error
      setTimeout(() => {
        const errorEl = document.querySelector('[data-error="true"]');
        if (errorEl) {
          errorEl.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 50);
      return;
    }

    loadRazorpayScript().catch(() => {}); // warm up while the user reviews
    setShowReview(true);
  };

  // Snapshot of everything sent to create-order (an unchanged form reuses the same order)
  const orderFingerprint = () =>
    JSON.stringify({
      ...form,
      playerPhoto: form.playerPhoto
        ? [form.playerPhoto.name, form.playerPhoto.size, form.playerPhoto.lastModified]
        : null,
      aadhaarFront: aadhaar.front.uploadId,
      aadhaarBack: aadhaar.back.uploadId,
    });

  const buildOrderFormData = () => {
    const formData = new FormData();
    formData.append("name", form.name.trim());
    formData.append("mobile", form.mobile.trim());
    formData.append("dateOfBirth", form.dateOfBirth);
    formData.append("bloodGroup", form.bloodGroup);
    formData.append("fatherName", form.fatherName.trim());
    formData.append("profession", form.profession);
    if (form.profession === "Other") {
      formData.append("professionOther", form.professionOther.trim());
    }
    if (form.previousTeam) {
      formData.append("previousTeam", form.previousTeam.trim());
    }
    formData.append("addressLine1", form.addressLine1.trim());
    if (form.addressLine2) {
      formData.append("addressLine2", form.addressLine2.trim());
    }
    formData.append("city", form.city.trim());
    formData.append("state", form.state.trim());
    formData.append("pinCode", form.pinCode.trim());
    formData.append("country", form.country.trim() || "India");
    formData.append("role", form.role);
    formData.append("playingStyle", JSON.stringify(form.playingStyle));
    formData.append("tShirtSize", form.tShirtSize);
    formData.append("tShirtNumber", form.tShirtNumber);
    formData.append("tShirtName", form.tShirtName.trim().toUpperCase());
    formData.append("playerPhoto", form.playerPhoto);
    formData.append("aadhaarFrontUploadId", aadhaar.front.uploadId);
    formData.append("aadhaarBackUploadId", aadhaar.back.uploadId);
    return formData;
  };

  const finishWithSuccess = (player) => {
    pendingOrderRef.current = null;
    paymentBusyRef.current = false;
    setPaymentPhase("idle");
    setPaymentNotice(null);
    toast.success("Payment verified — registration submitted successfully! 🏏");
    setSuccessData(player);
  };

  const endPaymentAttempt = (notice) => {
    paymentBusyRef.current = false;
    setPaymentPhase("idle");
    if (notice) setPaymentNotice(notice);
  };

  // Poll the server until the payment is confirmed (covers slow verification / lost callbacks)
  const pollOrderStatus = async (order) => {
    setPaymentPhase("verifying");
    setPaymentNotice({
      tone: "pending",
      title: "Confirming your payment…",
      message: "Please keep this page open. Do not pay again.",
      reference: order.orderId,
    });
    for (let i = 0; i < STATUS_POLL_ATTEMPTS; i++) {
      try {
        const res = await axios.post(
          "/api/payment/status",
          { orderId: order.orderId, clientToken: order.clientToken },
          { validateStatus: () => true },
        );
        const body = res.data || {};
        if (body.success && body.data?.state === "completed" && body.data.player) {
          finishWithSuccess(body.data.player);
          return;
        }
        if (body.state === "failed" || body.state === "rejected" || body.state === "expired") {
          if (body.state !== "failed") pendingOrderRef.current = null;
          endPaymentAttempt({ tone: "failed", title: "Payment not completed", message: body.message, reference: order.orderId });
          return;
        }
        if (body.success && body.data?.state === "awaiting_payment") {
          endPaymentAttempt({
            tone: "cancelled",
            title: "Payment not received",
            message: "We have not received a payment for this attempt. Your details are saved — you can try again.",
          });
          return;
        }
      } catch {
        /* network blip — keep polling */
      }
      await sleep(STATUS_POLL_INTERVAL_MS);
    }
    paymentBusyRef.current = false;
    setPaymentPhase("pending");
    setPaymentNotice({
      tone: "pending",
      title: "Payment confirmation is taking longer than usual",
      message:
        "Do NOT pay again. If your payment succeeded, your registration will be completed automatically. Tap “Check Payment Status” to refresh.",
      reference: order.orderId,
    });
  };

  const verifyPayment = async (order, response) => {
    setPaymentPhase("verifying");
    setPaymentNotice({
      tone: "pending",
      title: "Verifying your payment…",
      message: "Please don't close or refresh this page.",
      reference: order.orderId,
    });
    try {
      const res = await axios.post(
        "/api/payment/verify",
        {
          razorpay_order_id: response.razorpay_order_id,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_signature: response.razorpay_signature,
          clientToken: order.clientToken,
        },
        { validateStatus: () => true },
      );
      const body = res.data || {};
      if (body.success && body.data?.state === "completed" && body.data.player) {
        finishWithSuccess(body.data.player);
        return;
      }
      if (res.status === 202 || res.status === 503 || res.status >= 500) {
        await pollOrderStatus(order);
        return;
      }
      if (res.status === 402) {
        endPaymentAttempt({ tone: "failed", title: "Payment failed", message: body.message, reference: order.orderId });
        return;
      }
      pendingOrderRef.current = null;
      endPaymentAttempt({
        tone: "failed",
        title: "Payment could not be verified",
        message: body.message || "Please contact the organisers if money was deducted.",
        reference: order.orderId,
      });
    } catch {
      // Network failure after paying: the server may still have the payment — reconcile.
      await pollOrderStatus(order);
    }
  };

  const openCheckout = (order) => {
    let handled = false;
    let lastFailure = null;

    const rzp = new window.Razorpay({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      order_id: order.orderId,
      name: "JPL 2026",
      description: "Player Registration Fee",
      prefill: { name: order.prefill?.name, contact: order.prefill?.contact },
      notes: { receipt: order.receipt },
      theme: { color: "#16a34a" },
      timeout: 900, // seconds
      retry: { enabled: true, max_count: 3 },
      modal: {
        confirm_close: true,
        ondismiss: () => {
          if (handled) return;
          endPaymentAttempt(
            lastFailure
              ? {
                  tone: "failed",
                  title: "Payment failed",
                  message: `${lastFailure} Your details are saved — you can try again.`,
                }
              : {
                  tone: "cancelled",
                  title: "Payment cancelled",
                  message: "No money was taken. Your details are saved — tap Pay & Submit to try again.",
                },
          );
        },
      },
      handler: (response) => {
        handled = true;
        // Success callback is NOT proof of payment — the server verifies it.
        verifyPayment(order, response);
      },
    });

    rzp.on("payment.failed", (resp) => {
      lastFailure = resp?.error?.description || "The payment could not be completed.";
      setPaymentNotice({ tone: "failed", title: "Payment failed", message: lastFailure });
    });

    setPaymentPhase("checkout");
    rzp.open();
  };

  const startPayment = async () => {
    if (paymentBusyRef.current) return; // prevent double submission
    paymentBusyRef.current = true;
    setPaymentPhase("creating");
    setPaymentNotice(null);

    try {
      const fingerprint = orderFingerprint();
      let order = pendingOrderRef.current;
      if (!order || order.fingerprint !== fingerprint || Date.now() > order.reuseUntil) {
        const response = await axios.post("/api/payment/create-order", buildOrderFormData(), {
          headers: { "Content-Type": "multipart/form-data" },
        });
        order = { ...response.data.data, fingerprint, reuseUntil: Date.now() + 6 * 60 * 60 * 1000 };
        pendingOrderRef.current = order;
      }
      await loadRazorpayScript();
      setShowReview(false);
      openCheckout(order);
    } catch (err) {
      setShowReview(false);
      const serverMessage =
        err.response?.data?.message || err.message || "Could not start the payment. Please try again.";
      toast.error(serverMessage);
      const field = err.response?.data?.field;
      if (field === "aadhaarFront" || field === "aadhaarBack") {
        const side = field === "aadhaarFront" ? "front" : "back";
        setAadhaar((prev) => ({ ...prev, [side]: { ...prev[side], status: "error", uploadId: "", error: serverMessage } }));
        setErrors((prev) => ({ ...prev, [field]: serverMessage }));
      }
      endPaymentAttempt({ tone: "failed", title: "Payment not started", message: serverMessage });
      console.error("Payment start error:", err?.response?.status || err?.message);
    }
  };

  // --- Reset only after closing success modal ---
  const handleCloseSuccess = () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    if (aadhaar.front.preview) URL.revokeObjectURL(aadhaar.front.preview);
    if (aadhaar.back.preview) URL.revokeObjectURL(aadhaar.back.preview);
    setPhotoPreview("");
    aadhaarFileRef.current = { front: null, back: null };
    setAadhaar(INITIAL_AADHAAR);
    pendingOrderRef.current = null;
    setPaymentNotice(null);
    setPaymentPhase("idle");
    setSuccessData(null);
    setForm(INITIAL_STATE);
    setErrors(INITIAL_ERRORS);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const isPaying = ["creating", "checkout", "verifying"].includes(paymentPhase);

  return (
    <>
      {/* Success Modal */}
      {successData && (
        <SuccessModal player={successData} onClose={handleCloseSuccess} />
      )}

      {/* Review step before payment */}
      {showReview && !successData && (
        <ReviewModal
          form={form}
          previews={{ photo: photoPreview, aadhaarFront: aadhaar.front.preview, aadhaarBack: aadhaar.back.preview }}
          fee={registrationFee}
          busy={paymentPhase === "creating"}
          onEdit={() => setShowReview(false)}
          onConfirm={startPayment}
        />
      )}

      {/* Form Card */}
      <div
        className="relative rounded-3xl overflow-hidden"
        style={{
          background: `
            linear-gradient(
              180deg,
              rgba(6,18,33,0.98) 0%,
              rgba(10,25,48,0.98) 45%,
              rgba(4,10,20,0.98) 100%
            )
          `,
          border: "1px solid rgba(0,170,255,0.18)",
          boxShadow: `
            0 0 25px rgba(0,170,255,0.12),
            0 0 60px rgba(0,0,0,0.8),
            inset 0 0 18px rgba(255,140,0,0.06)
          `,
        }}
      >
        {/* Top tri-color accent line */}
        <div
          className="h-1 w-full"
          style={{
            background: `
              linear-gradient(
                90deg,
                rgba(0,170,255,1) 0%,
                rgba(255,183,0,1) 50%,
                rgba(231,111,6,1) 100%
              )
            `,
          }}
        />

        {/* Form fields */}
        <form
          onSubmit={handleSubmit}
          className="px-6 sm:px-8 py-8 flex flex-col gap-8"
          noValidate
        >
          {/* SECTION A: Personal Information */}
          <FormSection label="Personal Information" icon="👤" index={0}>
            {/* Full Name */}
            <div data-error={!!errors.name}>
              <InputField
                label="Full Name"
                name="name"
                value={form.name}
                onChange={handleChange("name")}
                placeholder="Enter player's complete legal name"
                required
                error={errors.name}
                icon="✍️"
              />
            </div>

            {/* Mobile Number */}
            <div data-error={!!errors.mobile}>
              <InputField
                label="Mobile Number"
                name="mobile"
                type="tel"
                value={form.mobile}
                onChange={handleChange("mobile")}
                placeholder="10-digit mobile number"
                required
                error={errors.mobile}
                icon="📱"
                maxLength={10}
                hint="Indian mobile numbers only (starting with 6, 7, 8 or 9)"
              />
            </div>

            {/* DOB & Marriage Anniversary */}
            <div data-error={!!errors.dateOfBirth}>
              <InputField
                label="Date of Birth"
                name="dateOfBirth"
                type="date"
                value={form.dateOfBirth}
                onChange={handleChange("dateOfBirth")}
                required
                error={errors.dateOfBirth}
                icon="🎂"
                hint={
                  computedAge !== null
                    ? `Calculated Age: ${computedAge} years`
                    : undefined
                }
              />
            </div>

            {/* Blood Group */}
            <div data-error={!!errors.bloodGroup}>
              <SelectField
                label="Blood Group"
                name="bloodGroup"
                value={form.bloodGroup}
                onChange={handleSelectChange("bloodGroup")}
                options={BLOOD_GROUPS}
                placeholder="Select Blood Group"
                required
                error={errors.bloodGroup}
                icon="🩸"
              />
            </div>

            {/* Father's & Mother's Name */}
            <div data-error={!!errors.fatherName}>
              <InputField
                label="Father's Full Name"
                name="fatherName"
                value={form.fatherName}
                onChange={handleChange("fatherName")}
                placeholder="Enter Father's name"
                required
                error={errors.fatherName}
                icon="👨"
              />
            </div>

            {/* Profession Searchable Dropdown */}
            <div data-error={!!errors.profession}>
              <SearchableSelect
                label="Profession"
                name="profession"
                value={form.profession}
                onChange={handleSelectChange("profession")}
                options={PROFESSIONS}
                placeholder="Search and select your profession (41 options)"
                required
                error={errors.profession}
                icon="💼"
                hint="Select 'Other' if your profession is not listed"
              />
            </div>

            {/* Conditional Other Profession Input */}
            {form.profession === "Other" && (
              <div
                className="animate-fade-in"
                data-error={!!errors.professionOther}
              >
                <InputField
                  label="Please Specify Your Profession"
                  name="professionOther"
                  value={form.professionOther}
                  onChange={handleChange("professionOther")}
                  placeholder="Describe your profession (max 100 characters)"
                  required
                  error={errors.professionOther}
                  icon="📝"
                  maxLength={100}
                  hint="Mandatory when 'Other' is selected"
                />
              </div>
            )}

            {/* Previous Team Dropdown */}
            <div data-error={!!errors.previousTeam}>
              <SelectField
                label="Previous Team"
                name="previousTeam"
                value={form.previousTeam}
                onChange={handleSelectChange("previousTeam")}
                options={PREVIOUS_TEAMS}
                placeholder="Select Previous Team (or N/A)"
                error={errors.previousTeam}
                icon="🛡️"
                hint="Select your previous tournament team or 'N/A'"
              />
            </div>
          </FormSection>

          {/* SECTION: Address Details (AddressSchema) */}
          <FormSection label="Address Details" icon="📍" index={1}>
            <div data-error={!!errors.addressLine1}>
              <InputField
                label="Address Line 1"
                name="addressLine1"
                value={form.addressLine1}
                onChange={handleChange("addressLine1")}
                placeholder="Flat / House No., Building Name, Street"
                required
                error={errors.addressLine1}
                icon="🏠"
              />
            </div>

            <div>
              <InputField
                label="Address Line 2 (Optional)"
                name="addressLine2"
                value={form.addressLine2}
                onChange={handleChange("addressLine2")}
                placeholder="Landmark, Area, Colony"
                error={errors.addressLine2}
                icon="📍"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div data-error={!!errors.city}>
                <InputField
                  label="City"
                  name="city"
                  value={form.city}
                  onChange={handleChange("city")}
                  placeholder="Enter your City"
                  required
                  error={errors.city}
                  icon="🏙️"
                />
              </div>

              <div data-error={!!errors.state}>
                <InputField
                  label="State"
                  name="state"
                  value={form.state}
                  onChange={handleChange("state")}
                  placeholder="Enter your State"
                  required
                  error={errors.state}
                  icon="🗺️"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div data-error={!!errors.pinCode}>
                <InputField
                  label="Pin Code"
                  name="pinCode"
                  value={form.pinCode}
                  onChange={handleChange("pinCode")}
                  placeholder="6-digit PIN Code"
                  required
                  maxLength={6}
                  error={errors.pinCode}
                  icon="📮"
                  hint="6-digit Indian Postal PIN Code"
                />
              </div>

              <div>
                <InputField
                  label="Country"
                  name="country"
                  value={form.country}
                  disabled
                  readOnly
                  icon="🇮🇳"
                />
              </div>
            </div>
          </FormSection>

          {/* SECTION B: Player Photo */}
          <FormSection label="Player Photo" icon="📸" index={2}>
            <div data-error={!!errors.playerPhoto}>
              <ImageUpload
                label="Upload Player Photo"
                name="playerPhoto"
                onImageSelect={handleImageSelect("playerPhoto")}
                previewUrl={photoPreview}
                error={errors.playerPhoto}
                icon="🤳"
                hint="Clear front-facing passport or portrait photo — JPG, PNG, or WebP (max 3 MB)"
                required
              />
            </div>
          </FormSection>

          {/* SECTION: Aadhaar Card (identity verification) */}
          <FormSection label="Aadhaar Card" icon="🪪" index={2}>
            <div data-error={!!errors.aadhaarFront}>
              <ImageUpload
                label="Aadhaar Card Front Image"
                name="aadhaarFront"
                onImageSelect={handleAadhaarSelect("front")}
                previewUrl={aadhaar.front.preview}
                error={errors.aadhaarFront}
                icon="🪪"
                hint={`Clear photo of the FRONT side of your Aadhaar card — JPG, JPEG or PNG (max ${AADHAAR_MAX_MB} MB)`}
                required
                accept="image/jpeg,image/png"
                allowedTypes={AADHAAR_ALLOWED_TYPES}
                allowedExtensions={AADHAAR_ALLOWED_EXTENSIONS}
                typeErrorMessage="Only JPG, JPEG, and PNG images are allowed."
                maxSizeBytes={AADHAAR_MAX_IMAGE_SIZE_BYTES}
                requireTypeAndExtension
                uploadState={aadhaar.front.file ? aadhaar.front : null}
                showActions
              />
            </div>

            <div data-error={!!errors.aadhaarBack}>
              <ImageUpload
                label="Aadhaar Card Back Image"
                name="aadhaarBack"
                onImageSelect={handleAadhaarSelect("back")}
                previewUrl={aadhaar.back.preview}
                error={errors.aadhaarBack}
                icon="🪪"
                hint={`Clear photo of the BACK side of your Aadhaar card — JPG, JPEG or PNG (max ${AADHAAR_MAX_MB} MB)`}
                required
                accept="image/jpeg,image/png"
                allowedTypes={AADHAAR_ALLOWED_TYPES}
                allowedExtensions={AADHAAR_ALLOWED_EXTENSIONS}
                typeErrorMessage="Only JPG, JPEG, and PNG images are allowed."
                maxSizeBytes={AADHAAR_MAX_IMAGE_SIZE_BYTES}
                requireTypeAndExtension
                uploadState={aadhaar.back.file ? aadhaar.back : null}
                showActions
              />
            </div>

            <p className="text-xs" style={{ color: "var(--color-text-dim)" }}>
              🔒 Your Aadhaar images are stored privately and are visible only to tournament
              administrators for identity and region verification.
            </p>
          </FormSection>

          {/* SECTION C: Playing Details */}
          <FormSection label="Playing Details" icon="🏏" index={2}>
            <div data-error={!!errors.playingStyle}>
              <PlayingStyleSelector
                selected={form.playingStyle}
                onChange={handlePlayingStyleChange}
                error={errors.playingStyle}
              />
            </div>

            <div data-error={!!errors.role}>
              <RoleSelector
                selected={form.role}
                onChange={handleRoleChange}
                error={errors.role}
              />
            </div>
          </FormSection>

          {/* SECTION D: Merchandise Information */}
          <FormSection label="Merchandise Information" icon="👕" index={3}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div data-error={!!errors.tShirtSize}>
                <SelectField
                  label="T-Shirt Size"
                  name="tShirtSize"
                  value={form.tShirtSize}
                  onChange={handleSelectChange("tShirtSize")}
                  options={CLOTHING_SIZES}
                  placeholder="Select T-Shirt Size"
                  required
                  error={errors.tShirtSize}
                  icon="👕"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div data-error={!!errors.tShirtNumber}>
                <InputField
                  label="T-Shirt Number (0–9999)"
                  name="tShirtNumber"
                  type="number"
                  min={TSHIRT_NUMBER_MIN}
                  max={TSHIRT_NUMBER_MAX}
                  value={form.tShirtNumber}
                  onChange={handleChange("tShirtNumber")}
                  placeholder="e.g. 7, 18, 45"
                  required
                  error={errors.tShirtNumber}
                  icon="🔢"
                  hint="Whole number between 0 and 9999"
                />
              </div>

              <div data-error={!!errors.tShirtName}>
                <InputField
                  label={`T-Shirt Name (${form.tShirtName.length}/${TSHIRT_NAME_MAX_LENGTH})`}
                  name="tShirtName"
                  value={form.tShirtName}
                  onChange={handleChange("tShirtName")}
                  placeholder="e.g. SHARMA, VIRAT"
                  required
                  error={errors.tShirtName}
                  icon="✍️"
                  maxLength={TSHIRT_NAME_MAX_LENGTH}
                  hint="Max 20 uppercase characters to be printed on jersey"
                />
              </div>
            </div>
          </FormSection>

          {/* SECTION E: Payment Information */}
          <FormSection label="Payment Information" icon="💳" index={4}>
            <RazorpayPayment fee={registrationFee} notice={paymentNotice} />
          </FormSection>

          {/* Registration Important Notes */}
          <div
            className="rounded-xl p-5 space-y-4"
            style={{
              background: "rgba(245,158,11,0.07)",
              border: "1px solid rgba(245,158,11,0.25)",
            }}
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">⚠️</span>
              <h3
                className="text-sm font-bold uppercase tracking-wider"
                style={{ color: "#fbbf24" }}
              >
                Important Notes
              </h3>
            </div>

            <ul className="space-y-3 text-sm leading-relaxed">
              <li className="flex items-start gap-3">
                <span className="font-bold mt-0.5" style={{ color: "#f59e0b" }}>
                  1.
                </span>
                <span style={{ color: "rgba(255,255,255,0.85)" }}>
                  Registration is strictly restricted to players belonging to
                  the{" "}
                  <strong className="text-white">
                    Sangli MNC or Dhamani or Ankali region
                  </strong>
                  . If a player is found to be from outside these regions, their
                  registration will be rejected and{" "}
                  <strong className="text-white">
                    no refund will be provided
                  </strong>{" "}
                  under any circumstances.
                </span>
              </li>

              <li className="flex items-start gap-3">
                <span className="font-bold mt-0.5" style={{ color: "#f59e0b" }}>
                  2.
                </span>
                <span style={{ color: "rgba(255,255,255,0.85)" }}>
                  Please upload your{" "}
                  <strong className="text-white">
                    latest and recent photograph
                  </strong>
                  . Ensure that your face is clearly visible and the photograph
                  accurately represents your current appearance. This will help
                  the organizers with easy identification and recognition
                  throughout the tournament.
                </span>
              </li>
            </ul>
          </div>

          {/* Submit Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isPaying}
              className="relative w-full py-4 rounded-xl font-bold text-base tracking-widest uppercase transition-all duration-200 overflow-hidden group shadow-lg"
              style={{
                background: isPaying
                  ? "rgba(34,197,94,0.3)"
                  : "linear-gradient(135deg, #16a34a 0%, #22c55e 50%, #16a34a 100%)",
                color: "#fff",
                fontFamily: "var(--font-display)",
                letterSpacing: "0.15em",
                cursor: isPaying ? "not-allowed" : "pointer",
                boxShadow: isPaying
                  ? "none"
                  : "0 8px 32px rgba(34,197,94,0.35)",
                fontSize: "16px",
              }}
            >
              {/* Shimmer effect */}
              {!isPaying && (
                <div
                  className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                  style={{
                    background:
                      "linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)",
                    backgroundSize: "200% 100%",
                    animation: "shimmer 1.5s linear infinite",
                  }}
                />
              )}

              {/* Button content */}
              <span className="relative flex items-center justify-center gap-3">
                {isPaying ? (
                  <>
                    <Spinner />
                    {PHASE_LABEL[paymentPhase] || "Processing..."}
                  </>
                ) : paymentPhase === "pending" ? (
                  <>
                    <span>🔄</span>
                    Check Payment Status
                  </>
                ) : (
                  <>
                    <span>🏏</span>
                    Pay ₹{registrationFee} &amp; Submit JPL 2026 Registration
                    <span>→</span>
                  </>
                )}
              </span>
            </button>

            <p
              className="text-center text-xs mt-3"
              style={{ color: "var(--color-text-dim)" }}
            >
              By registering, you confirm all details provided are accurate and
              the payment has been completed.
              <br />
              All participants agree to abide by the rules and regulations of
              JPL 2026.
            </p>
          </div>
        </form>
      </div>
    </>
  );
}

const PHASE_LABEL = {
  creating: "Preparing Secure Payment...",
  checkout: "Complete Payment in Razorpay...",
  verifying: "Verifying Payment...",
};

// Section wrapper component with label and accent line
function FormSection({ label, icon, index, children }) {
  return (
    <div
      className="form-section flex flex-col gap-5"
      style={{ animationDelay: `${0.1 + index * 0.05}s` }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center text-sm shadow-sm"
          style={{
            background: "rgba(34,197,94,0.12)",
            border: "1px solid rgba(34,197,94,0.25)",
          }}
        >
          {icon}
        </div>
        <h3
          className="text-xs font-semibold tracking-widest uppercase"
          style={{
            color: "rgba(34,197,94,0.9)",
            fontFamily: "var(--font-accent)",
          }}
        >
          {label}
        </h3>
        <div
          className="flex-1 h-px"
          style={{
            background:
              "linear-gradient(to right, rgba(34,197,94,0.2), transparent)",
          }}
        />
      </div>

      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}

// Loading Spinner SVG
function Spinner() {
  return (
    <svg
      className="animate-spin"
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        cx="9"
        cy="9"
        r="7"
        stroke="rgba(255,255,255,0.3)"
        strokeWidth="2"
      />
      <path
        d="M9 2a7 7 0 0 1 7 7"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
