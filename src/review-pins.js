export const PIN_LIMIT = 100;
export const PIN_TEXT_LIMIT = 500;

export function validatePinFile(value) {
  if (value?.version !== 1 || typeof value.modelSha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(value.modelSha256)
      || !Array.isArray(value.pins) || value.pins.length > PIN_LIMIT) {
    throw new Error('Choose a ModelCheck pins file.');
  }
  const pins = value.pins.map((pin) => {
    if (!Array.isArray(pin?.position) || pin.position.length !== 3 || !pin.position.every(Number.isFinite)
        || typeof pin.text !== 'string' || !pin.text.trim() || pin.text.length > PIN_TEXT_LIMIT) {
      throw new Error('A pin has invalid coordinates or note text.');
    }
    return { position: [...pin.position], text: pin.text.trim() };
  });
  return { version: 1, modelSha256: value.modelSha256, pins };
}
