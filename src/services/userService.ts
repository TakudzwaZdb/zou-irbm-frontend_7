import { latency } from "./mockUtils";
import { users } from "@/data/users";
import type { User } from "@/types/user";

export const userService = {
  list: (): Promise<User[]> => latency(users),
};
