import {
  ArrowLeftRight,
  Banknote,
  BarChart3,
  Bed,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle,
  CircleDot,
  Clock,
  DollarSign,
  ExternalLink,
  Globe,
  Inbox,
  Landmark,
  Mail,
  MapPin,
  Navigation,
  Newspaper,
  Package,
  Phone,
  Plane,
  Send,
  ShieldCheck,
  ShoppingBag,
  Star,
  Tag,
  Target,
  TrendingDown,
  TrendingUp,
  User,
  Utensils,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The icon names agents may reference by string. Mirrors the backend catalog
 * (`ResponseTemplates.Schema.icon_catalog/0`) — the server is the single
 * source; keep in sync with web's lib/cardIcons.ts and mobile's
 * lib/a2ui/icons.tsx. Used by the A2UI surface catalog.
 */
export const ICON_MAP: Record<string, LucideIcon> = {
  bed: Bed,
  "map-pin": MapPin,
  clock: Clock,
  plane: Plane,
  utensils: Utensils,
  calendar: Calendar,
  navigation: Navigation,
  "shield-check": ShieldCheck,
  "shopping-bag": ShoppingBag,
  "dollar-sign": DollarSign,
  mail: Mail,
  send: Send,
  inbox: Inbox,
  tag: Tag,
  "check-circle": CheckCircle,
  user: User,
  star: Star,
  package: Package,
  "external-link": ExternalLink,
  "trending-up": TrendingUp,
  "trending-down": TrendingDown,
  phone: Phone,
  globe: Globe,
  briefcase: Briefcase,
  "circle-dot": CircleDot,
  "building-2": Building2,
  landmark: Landmark,
  "arrow-left-right": ArrowLeftRight,
  target: Target,
  newspaper: Newspaper,
  banknote: Banknote,
  "bar-chart-3": BarChart3,
};

export function resolveIcon(name?: string | null): LucideIcon | null {
  if (!name) return null;
  return ICON_MAP[name] ?? null;
}
