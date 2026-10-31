/**
 * Compute the on-screen rectangle of the `object-fit: contain` video: the
 * whole camera frame, letterboxed inside the container (black bars above and
 * below on a phone). Capture and detection map viewport rects through this so
 * the cropped pixels stay aligned with what the user actually sees.
 */
export function computeDisplayRect(
  vW: number,
  vH: number,
  cW: number,
  cH: number
): { dispX: number; dispY: number; dispW: number; dispH: number } {
  const videoAspect = vW / vH;
  const containerAspect = cW / cH;
  if (videoAspect > containerAspect) {
    const dispW = cW;
    const dispH = cW / videoAspect;
    return { dispX: 0, dispY: (cH - dispH) / 2, dispW, dispH };
  }
  const dispH = cH;
  const dispW = cH * videoAspect;
  return { dispX: (cW - dispW) / 2, dispY: 0, dispW, dispH };
}
