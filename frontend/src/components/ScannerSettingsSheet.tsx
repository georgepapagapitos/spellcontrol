import type { Condition } from '../types';
import { Modal } from './Modal';
import { SelectMenu } from './SelectMenu';
import { SegmentedControl, SwitchRow } from './shared/form';
import { conditionLabel } from './shared/CardRow';
import { CONDITIONS } from '../lib/scanner-feedback';
import { useScannerSettings } from '../lib/scanner-settings';
import { SCANNER_SHEET_BACKDROP } from './ScannerQueueSheet';

/**
 * The scanner's own settings, from the gear on the camera. Only the defaults
 * that save the most taps when opening a box, plus the two things a scan
 * does on screen and out loud. Changes apply at once.
 */
export function ScannerSettingsSheet({ onClose }: { onClose: () => void }) {
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
          <h2 id="scanner-settings-title">Scanner settings</h2>
        </div>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="modal-body scanner-edit-body">
        <h3 className="form-section-heading">New cards start as</h3>
        <div className="scanner-edit-field">
          <span className="form-field-label">Finish</span>
          <SegmentedControl
            ariaLabel="Finish for new cards"
            value={s.defaultFinish}
            options={[
              { value: 'nonfoil', label: 'Normal' },
              { value: 'foil', label: 'Foil' },
            ]}
            onChange={(defaultFinish) => s.set({ defaultFinish })}
          />
          <p className="form-field-hint">
            Opening a box of foils? Set Foil once. A card with no foil printing stays Normal.
          </p>
        </div>
        <div className="scanner-edit-field">
          <span className="form-field-label">Condition</span>
          <SelectMenu<string>
            ariaLabel="Condition for new cards"
            value={s.defaultCondition}
            options={CONDITIONS.map((c) => ({ value: c, label: conditionLabel(c) }))}
            onChange={(c) => s.set({ defaultCondition: c as Condition })}
          />
        </div>

        <h3 className="form-section-heading">While scanning</h3>
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
      </div>
    </Modal>
  );
}
