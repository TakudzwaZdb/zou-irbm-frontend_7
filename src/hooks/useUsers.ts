import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { userService } from "@/services/userService";
import type { User } from "@/types/user";

export const useUsers = () => useQuery({ queryKey: ["users"], queryFn: userService.list });

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, createdBy }: { payload: Omit<User, "id" | "status" | "lastLogin">; createdBy: string }) =>
      userService.create(payload, createdBy),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, changes, updatedBy }: { id: string; changes: Partial<User>; updatedBy: string }) =>
      userService.update(id, changes, updatedBy),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}
<<<<<<< HEAD

export function useApproveUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, approvedBy }: { id: string; approvedBy: string }) => userService.approve(id, approvedBy),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useRejectUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rejectedBy, reason }: { id: string; rejectedBy: string; reason: string }) => userService.reject(id, rejectedBy, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}
=======
>>>>>>> 7766e67ea15f7e1d0e6c85da5d24ea3d8fc97fe3
