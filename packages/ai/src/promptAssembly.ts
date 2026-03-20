/**
 * Prompt Assembly
 *
 * Injects a pot role into a base system prompt.
 * The role is always appended AFTER the base system prompt so that
 * existing injection-defence instructions in the base prompt apply first.
 */

/**
 * Inject a role into a base system prompt.
 *
 * The role section is appended after the base system prompt with a clear
 * `[POT_ROLE]` delimiter. If `roleText` is empty or whitespace-only,
 * the original `baseSystemPrompt` is returned unchanged (no `[POT_ROLE]` section).
 *
 * Structure of the returned string:
 * ```
 * [SYSTEM_BASELINE]
 * <baseSystemPrompt>
 *
 * [POT_ROLE]
 * <roleText>
 * ```
 *
 * @param baseSystemPrompt - The system section from the prompt template
 * @param roleText - The canonicalised role text from resolveEffectiveRole()
 * @returns Combined system prompt string
 */
export function injectRoleIntoSystemPrompt(
  baseSystemPrompt: string,
  roleText: string
): string {
  const trimmedRole = roleText.trim();

  if (!trimmedRole) {
    // No role to inject — return baseline only, without delimiter overhead
    return `[SYSTEM_BASELINE]\n${baseSystemPrompt}`;
  }

  return `[SYSTEM_BASELINE]\n${baseSystemPrompt}\n\n[POT_ROLE]\n${trimmedRole}`;
}
