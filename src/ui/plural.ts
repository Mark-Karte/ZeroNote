/**
 * Русское числительное: «1 курсор», «2 курсора», «5 курсоров».
 *
 * Отдельным модулем, потому что нужно уже в двух местах — в подписи давности
 * и в счётчике курсоров, — а склонение по остатку от деления пишут неправильно
 * чаще, чем правильно: одиннадцать ведёт себя не как один.
 */
export function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(count) % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = mod100 % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
