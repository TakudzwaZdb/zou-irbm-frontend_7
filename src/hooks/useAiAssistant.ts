import { useMutation } from "@tanstack/react-query";
import { aiService } from "@/services/aiService";
import type { User } from "@/types/user";

export function useAskAssistant() {
  return useMutation({
    mutationFn: ({ query, user }: { query: string; user: User }) => aiService.ask(query, user),
  });
}
