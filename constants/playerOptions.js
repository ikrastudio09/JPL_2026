/**
 * Shared Player Options Constants - Single Source of Truth
 * Used across Frontend, Backend API, Mongoose Schema, and Admin Dashboard.
 */

export const BLOOD_GROUPS = [
  "A+",
  "A-",
  "B+",
  "B-",
  "AB+",
  "AB-",
  "O+",
  "O-",
];

export const PROFESSIONS = [
  "Software Developer",
  "Engineer (Non- IT)",
  "Doctor",
  "Pharmacy",
  "Chartered Accountant (CA)",
  "Company Secretary (CS)",
  "Cost Accountant / Tax consultant",
  "Banking, Finance & Insurance",
  "Lawyer / Legal",
  "Teacher / Professor / Education",
  "Government service",
  "Architect / Interior designer",
  "Turmeric (Haldi)",
  "Textile & Garments",
  "Raisins",
  "Jewellery / Gold & Silver",
  "Industry / Manufacturing",
  "Builder / Real estate / Construction",
  "Transport & Logistics",
  "Automobile / Vehicle dealership",
  "Hotel, Restaurant & Food",
  "Trader / Wholesale / Distributor",
  "Shop / Retail / Showroom",
  "Agriculture / Farming",
  "Media, Design & Marketing",
  "Private job / Corporate employee",
  "Self-employed / Consultant",
  "Agriculture Product Trading",
  "Student",
  "Homemaker",
  "Retired",
  "Cooking classes, tiffin, cakes & bakes",
  "Art & Craft / Gifting & Packaging",
  "Teaching / Tutoring / Educational Classes",
  "Event Management / Anchoring / Choreography",
  "Boutique / Fashion Designing",
  "Home Baker / Cooking Classes",
  "Yoga & Zumba Trainer / Fitness & Nutrition Coach",
  "Hair & Makeup Artist / Mehndi & Nail Artist",
  "Astrology / Vastu Visharad",
  "Other",
];

export const PLAYER_ROLES = ["Batsman", "Bowler", "All Rounder"];

export const PREVIOUS_TEAMS = [
  "AIRAWAT DEMIGODS GANPATI PETH",
  "ANKALI AVENGERS",
  "Chintamani Nagar Tuskers",
  "DHAMANI WARRIORS",
  "DUTT NAGAR BLISS BLASTERS",
  "GAOBHAG FIGHTERS",
  "GULMOHAR GIANTS",
  "MARKET YARD ROWDY ROYALS",
  "MRUTUNJAY SPORTS MAHAVNAGAR",
  "NEMINATHNAGAR WARRIORS",
  "PARSHWANATH PALTAN",
  "PATKARNAGAR PANTHERS",
  "ROYAL CRICKETERS BALAJINAGAR",
  "VAKARBAUG KINGS",
  "VENKATESH NAGAR RUDRA TITANS",
  "VISHRAMBAUG TITANS",
  "N/A",
];

export const PLAYING_STYLES = [
  "Right Arm Batting",
  "Right Arm Balling",
  "Left Arm Batting",
  "Left Arm Balling",
];

export const CLOTHING_SIZES = [
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "XXL",
  "XXXL",
];

export const TSHIRT_NUMBER_MIN = 0;
export const TSHIRT_NUMBER_MAX = 9999;
export const TSHIRT_NAME_MAX_LENGTH = 20;
export const MAX_IMAGE_SIZE_BYTES = 3 * 1024 * 1024; // 3 MB
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
];

// Aadhaar card document uploads (front & back) — JPG/JPEG/PNG only.
// 4 MB keeps each independent upload request safely under Vercel's 4.5 MB body limit.
export const AADHAAR_MAX_IMAGE_SIZE_BYTES = 4 * 1024 * 1024; // 4 MB
export const AADHAAR_ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png"];
export const AADHAAR_ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png"];
export const AADHAAR_SIDES = ["front", "back"];
