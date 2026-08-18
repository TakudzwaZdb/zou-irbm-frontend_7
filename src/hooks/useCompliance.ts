import { useQuery } from "@tanstack/react-query";
import { complianceService } from "@/services/complianceService";

export const useCompliance = () => useQuery({ queryKey: ["compliance"], queryFn: complianceService.list });
