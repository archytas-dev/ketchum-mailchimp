import { tierBadgeClasses, tierLabel, type TierValue } from "@/lib/tier";

export default function TierBadge({ tier }: { tier: TierValue }) {
  return (
    <span
      className={
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium " +
        tierBadgeClasses(tier)
      }
    >
      {tierLabel(tier)}
    </span>
  );
}
