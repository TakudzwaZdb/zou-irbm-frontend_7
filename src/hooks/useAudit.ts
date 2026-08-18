import { useQuery } from "@tanstack/react-query";
import { auditService } from "@/services/auditService";

export const useAuditLog = () => useQuery({ queryKey: ["audit"], queryFn: auditService.list });
