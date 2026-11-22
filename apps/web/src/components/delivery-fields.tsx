export function DeliveryFields() {
  return (
    <div className="field-pair">
      <label className="form-field">
        <span>Delivery time</span>
        <select name="slot" defaultValue="morning" required>
          <option value="morning">Morning</option>
          <option value="afternoon">Afternoon</option>
          <option value="evening">Evening</option>
        </select>
      </label>
      <label className="form-field">
        <span>Timezone</span>
        <input name="timezone" defaultValue="Asia/Kolkata" maxLength={64} required />
      </label>
    </div>
  );
}
