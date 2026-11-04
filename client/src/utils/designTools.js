// The look switchers (navigation, guests page) are for the owner while choosing a design.
// Customers never see them: open any page with ?design=1 once to turn them on, ?design=0 to turn them off.
const KEY = 'hotel4u:design-tools';

export function designToolsOn() {
  try {
    const q = new URLSearchParams(window.location.search).get('design');
    if (q === '1') localStorage.setItem(KEY, '1');
    if (q === '0') localStorage.removeItem(KEY);
    return localStorage.getItem(KEY) === '1';
  } catch { return false; }
}
