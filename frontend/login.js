// PAGE 2 → SEND OTP (PHONE NUMBER)

function goToOTP() {
  const code = document.getElementById("countryCode").value;
  const phone = document.getElementById("phone").value.trim();

  if (!phone) {
    alert("Enter phone number");
    return;
  }

  const fullNumber = code + phone;

  // ❌ phone abhi login nahi maana jayega
  localStorage.setItem("tempPhone", fullNumber);

  // Generate unique OTP per phone number (6 digits)
  // Using phone number hash to generate consistent but unique OTP
  function generateOTP(phoneNum) {
    // Simple hash function to generate OTP based on phone number
    let hash = 0;
    for (let i = 0; i < phoneNum.length; i++) {
      const char = phoneNum.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    // Generate 6-digit OTP (100000 to 999999)
    const otp = Math.abs(hash % 900000) + 100000;
    return otp.toString();
  }

  const uniqueOTP = generateOTP(fullNumber);
  localStorage.setItem("otp", uniqueOTP);
  alert("OTP sent: " + uniqueOTP);

  window.location.href = "otp.html";
}

// PAGE 3 → VERIFY OTP
function verifyOTP() {
  const otp = document
    .getElementById("otp")
    .value
    .replace(/\s/g, "");

  const savedOTP = localStorage.getItem("otp");
  const phone = localStorage.getItem("tempPhone");

  if (!otp) {
    alert("Enter OTP");
    return;
  }

  if (otp === savedOTP && phone) {
    localStorage.setItem("isLoggedIn", "true");
    localStorage.setItem("phone", phone);

    localStorage.removeItem("otp");
    localStorage.removeItem("tempPhone");

    window.location.href = "index.html";
  } else {
    alert("Invalid OTP");
  }
}
