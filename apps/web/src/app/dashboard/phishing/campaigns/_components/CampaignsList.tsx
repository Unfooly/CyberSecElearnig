import Link from 'next/link';
import Card from '@/components/ui/Card';
import Pill, { type PillTone } from '@/components/ui/Pill';
import { formatDateTime } from '@/lib/datetime';
import { CAMPAIGN_STATUS_LABELS, type Campaign, type CampaignStatus } from '@/lib/phishing-types';

export const STATUS_TONES: Record<CampaignStatus, PillTone> = {
  SCHEDULED: 'acc',
  RUNNING: 'acc',
  COMPLETED: 'ok',
  CANCELLED: 'off',
};

export default function CampaignsList({ campaigns }: { campaigns: Campaign[] }) {
  if (campaigns.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-muted">
        Nie masz jeszcze żadnej kampanii. Kliknij „Nowa kampania”, aby wysłać pierwszą symulację.
      </Card>
    );
  }
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
              <th className="px-5 py-3">Kampania</th>
              <th className="px-5 py-3">Status</th>
              <th className="hidden px-5 py-3 md:table-cell">Okno wysyłki</th>
              <th className="hidden px-5 py-3 text-right md:table-cell">Odbiorcy</th>
              <th className="hidden px-5 py-3 text-right md:table-cell">Wysłano</th>
              <th className="hidden px-5 py-3 text-right md:table-cell">Niepewne</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((campaign) => (
              <tr key={campaign.id} className="border-b border-border last:border-0">
                <td className="px-5 py-3">
                  <Link href={`/dashboard/phishing/campaigns/${campaign.id}`} className="font-semibold text-accent-ink hover:underline">
                    {campaign.name}
                  </Link>
                  <div className="text-xs text-muted">{campaign.templateName}</div>
                </td>
                <td className="px-5 py-3">
                  <Pill tone={STATUS_TONES[campaign.status]}>{CAMPAIGN_STATUS_LABELS[campaign.status]}</Pill>
                </td>
                <td className="hidden px-5 py-3 text-muted md:table-cell">
                  {formatDateTime(campaign.windowStart)}
                  <br />
                  <span className="text-xs">do {formatDateTime(campaign.windowEnd)}</span>
                </td>
                <td className="hidden px-5 py-3 text-right md:table-cell">{campaign.counts.total}</td>
                <td className="hidden px-5 py-3 text-right md:table-cell">{campaign.counts.sent}</td>
                <td className="hidden px-5 py-3 text-right md:table-cell">{campaign.counts.uncertain}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
