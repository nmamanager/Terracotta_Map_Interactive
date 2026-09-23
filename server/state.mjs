export const SCREEN_IDS = [1, 2, 3];

export function initialState() {
  return { seq: 0, selections: { 1: null, 2: null, 3: null } };
}

export function reduce(state, msg, screenByLandmark) {
  if (!SCREEN_IDS.includes(msg?.screen)) return state;
  let next;
  switch (msg.type) {
    case 'select':
    case 'hello': {
      const landmark = msg.type === 'select' ? msg.landmark : msg.selection;
      if (landmark !== null && screenByLandmark[landmark] !== msg.screen) return state;
      next = landmark;
      break;
    }
    case 'clear':
      next = null;
      break;
    default:
      return state;
  }
  if (state.selections[msg.screen] === next) return state;
  return { seq: state.seq + 1, selections: { ...state.selections, [msg.screen]: next } };
}
