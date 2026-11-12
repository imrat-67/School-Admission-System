// Small fetch wrapper. Backend URL comes from the environment (runtime config.js or VITE_API_URL).
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status; // 0 = server not reachable
    this.code = code;
  }
}

const baseUrl = () =>
  (window.__CONFIG__?.API_URL || import.meta.env.VITE_API_URL || 'http://localhost:8080').replace(/\/$/, '');

// difference between server clock and browser clock, learned from the HTTP Date header,
// so countdowns stay right even if the laptop clock is a bit off
let clockOffset = 0;
export const serverNow = () => Date.now() + clockOffset;

export async function api(path, { method = 'GET', studentId, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (studentId) headers['X-Student-Id'] = studentId;

  let res;
  try {
    res = await fetch(baseUrl() + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'network');
  }

  const date = res.headers.get('Date');
  if (date && !Number.isNaN(Date.parse(date))) clockOffset = Date.parse(date) - Date.now();

  if (res.status === 204) return null;
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) throw new ApiError(res.status, data?.code || 'HTTP_' + res.status, data?.error || 'error');
  return data;
}

const MESSAGES = {
  NETWORK: 'সার্ভারের সাথে যোগাযোগ করা যাচ্ছে না। সার্ভার চালু আছে কিনা দেখে একটু পরে আবার চেষ্টা করুন।',
  SEATS_FULL: 'দুঃখিত, এই ক্লাসে এখন আর কোনো আসন খালি নেই।',
  ALREADY_APPLIED: 'এই শিক্ষার্থী ইতিমধ্যে এই ক্লাসে আবেদন করেছে (আবেদন চলমান আছে অথবা ভর্তি নিশ্চিত হয়েছে)।',
  HOLD_EXPIRED: 'আবেদনের সময় শেষ হয়ে গেছে, তাই আসনটি ছেড়ে দেওয়া হয়েছে। চাইলে নতুন করে আবেদন করুন।',
  HOLD_CANCELLED: 'এই আবেদনটি আগেই বাতিল করা হয়েছে।',
  ALREADY_CONFIRMED: 'ভর্তি ফি জমা হয়ে গেছে, নিশ্চিত ভর্তি এখান থেকে বাতিল করা যায় না।',
  NOT_OWNER: 'এই আবেদনটি অন্য শিক্ষার্থীর, আপনি এটি পরিবর্তন করতে পারবেন না।',
  NOT_FOUND: 'যা খুঁজছেন তা আর নেই। তালিকা নতুন করে দেখুন।',
  MISSING_STUDENT_ID: 'আগে উপরে শিক্ষার্থীর জন্ম নিবন্ধন নম্বর লিখে সংরক্ষণ করুন।',
  INVALID_STUDENT_ID: 'জন্ম নিবন্ধন নম্বর ঠিক ১৭টি সংখ্যার হতে হবে (শুধু ০-৯)।',
  INVALID_NAME: 'ক্লাসের নাম লিখুন (সর্বোচ্চ ২০০ অক্ষর)।',
  SEATS_BELOW_USED: 'মোট আসন এখনই ধরা বা নিশ্চিত আসনের চেয়ে কম করা যাবে না।',
  INVALID_SEATS: 'আসন সংখ্যা ১ থেকে ১,০০,০০০ এর মধ্যে একটি পূর্ণ সংখ্যা হতে হবে।',
  INVALID_REQUEST: 'পাঠানো তথ্য ঠিক নেই। ঘরগুলো ঠিকমতো পূরণ করে আবার চেষ্টা করুন।',
  SERVER_ERROR: 'সার্ভারে একটি সমস্যা হয়েছে। একটু পরে আবার চেষ্টা করুন।'
};

export function errorText(e) {
  if (e instanceof ApiError) return MESSAGES[e.code] || (e.status >= 500 ? MESSAGES.SERVER_ERROR : 'কাজটি করা যায়নি। আবার চেষ্টা করুন।');
  return MESSAGES.SERVER_ERROR;
}

export const NET_MSG = MESSAGES.NETWORK;
