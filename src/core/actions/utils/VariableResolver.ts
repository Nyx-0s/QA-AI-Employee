export class VariableResolver {

    static resolve(
        value: string | undefined,
        variables: Record<string, unknown>
    ): string {

        if (!value) {
            return "";
        }

        return value.replace(
            /\$\{([^}]+)\}/g,
            (_, key) => String(variables[key] ?? "")
        );

    }

}
