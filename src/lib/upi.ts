// UPI payment links: "Pay ₹605" opens the phone's UPI app (GPay, PhonePe,
// Paytm, BHIM …) with the team's UPI ID, the amount and a note filled in.
// The app never touches the money: the player confirms in their UPI app, and
// the admin marks the share paid as before.

/** name@bank — letters, digits, dot, dash and underscore before the @, a bank handle after. */
export const UPI_ID = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/

export function checkUpi(id: string, name: string): { id: string; name: string } | undefined {
  const pa = id.trim()
  const pn = name.trim().replace(/\s+/g, ' ')
  if (!pa && !pn) return undefined
  if (!UPI_ID.test(pa)) throw new Error('Enter a UPI ID like name@okicici.')
  if (!pn) throw new Error('Enter the name on that UPI account, so players see who they are paying.')
  if (pn.length > 50) throw new Error('Keep the account name under 50 letters.')
  return { id: pa, name: pn }
}

/** A upi://pay link. `note` shows in the payer's app and on the payee's statement. */
export function upiLink(upi: { id: string; name: string }, amount: number, note: string): string {
  const q = new URLSearchParams({ pa: upi.id, pn: upi.name, am: (Math.round(amount * 100) / 100).toFixed(2), cu: 'INR', tn: note.slice(0, 50) })
  // Spaces as %20 and the @ of the UPI ID left as it is: some UPI apps reject "+" or "%40".
  return `upi://pay?${q.toString().replace(/\+/g, '%20').replace(/%40/g, '@')}`
}
