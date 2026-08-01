import { createPortal } from 'react-dom';

/**
 * ModalPortal renders its children at the root of document.body
 * so that position: fixed overlays avoid container transform/padding offsets.
 */
export const ModalPortal = ({ children }) => {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
};

export default ModalPortal;
