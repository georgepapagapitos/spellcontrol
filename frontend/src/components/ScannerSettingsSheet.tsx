import { X } from 'lucide-react';
import { Modal } from './Modal';
import { IconButton } from './shared/Button';
import { SelectMenu } from './SelectMenu';
import { Field, SegmentedControl, SwitchRow } from './shared/form';
import { ConditionControl } from './CopyControls';
import { FINISH_LABELS } from '../lib/scanner-feedback';
import { LANGUAGE_OPTIONS } from '../lib/copy-options';
import { useScannerSettings } from '../lib/scanner-settings';
import { SCANNER_SHEET_BACKDROP } from './ScannerQueueSheet';
// Its `.scanner-*` classes live here (shared with the scanner's own sheets).
// Imported directly so this sheet carries its stylesheet wherever it's
// reached from — the scanner's chunk today, Add cards' own lazy import too
// (css-chunk-ownership.test.ts) — instead of relying on a parent to import it.
import '@/styles/admin-scanner.css';

/**
 * Language at add time. English is the unmarked default, so it stands where
 * "Not set" stood and adds nothing to the stored copy; mirrors
 * PrintingPicker's ADD_LANGUAGE_OPTIONS (kept local — a leaf-level, three-line
 * filter isn't worth a shared export for two call sites).
 */
const ADD_LANGUAGE_OPTIONS = LANGUAGE_OPTIONS.filter((o) => o.value !== 'en').map((o) =>
  o.value === '' ? { ...o, label: 'English' } : o
);

/**
 * The one settings sheet for every new copy (T153): opened from the
 * scanner's gear and from Add cards' gear, both on the same `useScannerSettings`
 * store. "New copies" (finish/condition/language) always shows — it's what
 * both entry points exist to set. "Scanner" (sound/show total) only means
 * anything on a device that can scan; opened from the scanner itself that's
 * always true (`showScannerSection` defaults to it), and Add cards passes its
 * own `useCanScan()` result so a phone can still preset the scanner before
 * switching to that tab, while a desktop guest never sees a section for
 * hardware it doesn't have.
 */
export function ScannerSettingsSheet({
  onClose,
  showScannerSection = true,
}: {
  onClose: () => void;
  showScannerSection?: boolean;
}) {
  const s = useScannerSettings();
  return (
    <Modal
      onClose={onClose}
      className="modal scanner-edit-sheet"
      backdropClassName={SCANNER_SHEET_BACKDROP}
      labelledBy="scanner-settings-title"
    >
      <div className="modal-header scanner-sheet-head">
        <div className="scanner-sheet-heading">
          <h2 id="scanner-settings-title">Add settings</h2>
        </div>
        <IconButton
          variant="quiet"
          onClick={onClose}
          label="Close"
          icon={<X width={20} height={20} strokeWidth={1.8} />}
        />
      </div>
      <div className="modal-body scanner-edit-body">
        <h3 className="form-section-heading">New copies</h3>
        <div className="scanner-edit-field">
          <span className="form-field-label">Finish</span>
          <SegmentedControl
            ariaLabel="Finish for new cards"
            value={s.defaultFinish}
            options={[
              { value: 'nonfoil', label: FINISH_LABELS.nonfoil },
              { value: 'foil', label: FINISH_LABELS.foil },
            ]}
            onChange={(defaultFinish) => s.set({ defaultFinish })}
          />
          <p className="form-field-hint">
            Opening a box of foils? Set Foil once. A card with no foil printing stays Non-foil.
          </p>
        </div>
        <ConditionControl
          value={s.defaultCondition}
          onChange={(defaultCondition) => s.set({ defaultCondition })}
        />
        <Field label="Language">
          <SelectMenu
            ariaLabel="Language for new cards"
            value={s.defaultLanguage}
            options={ADD_LANGUAGE_OPTIONS}
            onChange={(defaultLanguage) => s.set({ defaultLanguage })}
          />
        </Field>

        {showScannerSection && (
          <>
            <h3 className="form-section-heading">Scanner</h3>
            <SwitchRow
              label="Sound on each scan"
              hint="A higher chime for pricier cards."
              checked={s.sound}
              onChange={(sound) => s.set({ sound })}
            />
            <SwitchRow
              label="Show the running total"
              hint="The value of everything scanned so far, beside the card count."
              checked={s.showTotal}
              onChange={(showTotal) => s.set({ showTotal })}
            />
          </>
        )}
      </div>
    </Modal>
  );
}
