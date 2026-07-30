// Price slider
const priceRange = document.getElementById('priceRange');
const priceVal   = document.getElementById('priceVal');
priceRange.addEventListener('input', () => {
  priceVal.textContent = priceRange.value == 300 ? '300+' : priceRange.value;
});

// Progress bar
const sections     = document.querySelectorAll('.section');
const allInputs    = document.querySelectorAll('input[type="checkbox"], input[type="radio"]');
const progressFill = document.getElementById('progressFill');

allInputs.forEach(input => input.addEventListener('change', updateProgress));
priceRange.addEventListener('input', updateProgress);
// update progress bar based on the amount of user input
function updateProgress() {
  const filled = [...sections].filter(section =>
    section.querySelector('input:checked') ||
    section.querySelector('input[type="text"]')?.value ||
    section.querySelector('select')?.value
  ).length;
  progressFill.style.width = Math.round((filled / sections.length) * 100) + '%';
}

// ── Google Places Autocomplete ────────────────────────────────────────────────

let addressVerified = false; // tracks whether user picked from dropdown
let autocompleteReady = false; // false if the Maps JS API never loaded

// Auto complete for search bar
function initAutocomplete() {
  const input      = document.getElementById('locationInput');
  const latInput   = document.getElementById('latInput');
  const lngInput   = document.getElementById('lngInput');
  const fmtInput   = document.getElementById('formattedInput');
  const errorMsg   = document.getElementById('addressError');

  // Restrict suggestions to Madison WI area
  const madisonBounds = new google.maps.LatLngBounds(
    new google.maps.LatLng(42.9, -89.6),  // SW corner
    new google.maps.LatLng(43.2, -89.1)   // NE corner
  );

  const autocomplete = new google.maps.places.Autocomplete(input, {
    bounds:                madisonBounds,
    strictBounds:          false,        // still shows outside results if nothing local matches
    componentRestrictions: { country: 'us' },
    types:                 ['address'],  // addresses only, no businesses
    fields:                ['formatted_address', 'geometry'] // only fetch what we need
  });

  // When user picks a suggestion from the dropdown
  autocomplete.addListener('place_changed', () => {
    const place = autocomplete.getPlace();

    if (!place.geometry) {
      // User typed something but didn't pick from dropdown
      addressVerified = false;
      latInput.value  = '';
      lngInput.value  = '';
      fmtInput.value  = '';
      return;
    }

    // Store everything
    addressVerified  = true;
    latInput.value   = place.geometry.location.lat();
    lngInput.value   = place.geometry.location.lng();
    fmtInput.value   = place.formatted_address;

    // Update the visible input to the clean formatted address
    input.value      = place.formatted_address;

    // Hide any error
    errorMsg.style.display = 'none';
    updateProgress();
  });

  // If user manually edits the field after picking, mark as unverified
  input.addEventListener('input', () => {
    addressVerified = false;
    latInput.value  = '';
    lngInput.value  = '';
    fmtInput.value  = '';
  });

  autocompleteReady = true;
}

// ── Form validation on submit ─────────────────────────────────────────────────

document.getElementById('surveyForm').addEventListener('submit', (e) => {
  const input    = document.getElementById('locationInput');
  const errorMsg = document.getElementById('addressError');

  // Only validate if the user typed something in the address field.
  // If the Maps API never loaded there is no dropdown to pick from, so requiring a
  // verified pick would lock the user out — the server geocodes the raw text instead.
  if (autocompleteReady && input.value.trim() !== '' && !addressVerified) {
    e.preventDefault();
    errorMsg.style.display = 'block';
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  errorMsg.style.display = 'none';
});

// Called by the Maps API script once it finishes loading
window.initAutocomplete = initAutocomplete;