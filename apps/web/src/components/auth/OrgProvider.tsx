import { createContext, useContext, type ReactNode } from "react";
import type {
  MemberRole,
  OrganizationDetailResponse,
} from "@pensia-docflow/shared";

export interface OrgContextValue {
  orgId: string;
  org: OrganizationDetailResponse;
  role: MemberRole;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({
  value,
  children,
}: {
  value: OrgContextValue;
  children: ReactNode;
}) {
  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg(): OrgContextValue {
  const value = useContext(OrgContext);
  if (value === null) {
    throw new Error("useOrg debe usarse dentro de OrgProvider.");
  }
  return value;
}
