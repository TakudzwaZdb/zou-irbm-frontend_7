import { useQuery } from "@tanstack/react-query";
import { userService } from "@/services/userService";

export const useUsers = () => useQuery({ queryKey: ["users"], queryFn: userService.list });
