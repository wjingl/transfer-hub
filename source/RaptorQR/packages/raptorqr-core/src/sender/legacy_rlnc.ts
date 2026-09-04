/**
 * Deprecated JS RLNC sender path.
 *
 * This module exists so app code can opt into the legacy codec from one import
 * site. RaptorQ must not import from here or fall back to it.
 */

export {
  packetize as packetizeLegacyRlnc,
  type PacketizerOptions as LegacyRlncPacketizerOptions,
  type PacketizerResult as LegacyRlncPacketizerResult,
} from './packetizer';
export { scheduleFrames as scheduleLegacyRlncFrames } from './scheduler';
