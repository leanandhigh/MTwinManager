import type { AccountSummary, Group, VaultMode } from "../../api";
import { t } from "../../i18n";
import { Segmented } from "../../ui/controls";
import { Dialog } from "../../ui/Dialog";
import { DetailCookie } from "./DetailCookie";
import { Organise } from "./DetailOverview";
import { accountName, Avatar } from "./shared";

/** An account's details (name, groups, colour, favourite, MAIN, notes) and its cookie, from its menu:
 * what the side panel held. Its launch options are in Settings > Launching > Per-account. */
export function AccountDialog({ account: a, tab, onTab, groups, vaultMode, clipboardSeconds, onClose }: {
  account: AccountSummary | undefined;
  tab: "details" | "cookie";
  onTab: (tab: "details" | "cookie") => void;
  groups: Group[];
  vaultMode: VaultMode;
  clipboardSeconds: number;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!a} onClose={onClose} title={a ? accountName(a) : ""} width={560}>
      {a && (
        <div className="acc-dlg dlg-body">
          <div className="acc-dlg-who">
            <Avatar account={a} size={40} />
            <span className="min-w-0">
              <span className="block font-semibold truncate">@{a.username}</span>
              <span className="block text-[12.5px] text-fg-3 mono">ID {a.userId}</span>
            </span>
            <Segmented
              className="ms-auto"
              label={t("accounts.details")}
              value={tab}
              options={[
                { value: "details", label: t("accounts.dialog.details") },
                { value: "cookie", label: t("accounts.tab.cookie") },
              ]}
              onChange={onTab}
            />
          </div>
          {tab === "details" ? <Organise account={a} groups={groups} /> : <DetailCookie account={a} vaultMode={vaultMode} clipboardSeconds={clipboardSeconds} />}
        </div>
      )}
    </Dialog>
  );
}
