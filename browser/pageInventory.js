(() => {
    const visible = (el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.display !== "none" &&
               s.visibility !== "hidden" &&
               Number(s.opacity) !== 0 &&
               r.width > 0 &&
               r.height > 0;
    };

    const collect = (selector) =>
        [...document.querySelectorAll(selector)].map(el => ({
            tag: el.tagName.toLowerCase(),
            text: (el.innerText || el.textContent || "").trim(),
            id: el.id || "",
            name: el.name || "",
            type: el.type || "",
            placeholder: el.placeholder || "",
            href: el.href || "",
            visible: visible(el)
        }));

    return {
        title: document.title,
        url: location.href,
        inputs: collect("input"),
        buttons: collect("button,[role=button]"),
        dropdowns: collect("select"),
        uploads: collect("input[type=file]"),
        textareas: collect("textarea"),
        links: collect("a"),
        tables: document.querySelectorAll("table").length
    };
})()
