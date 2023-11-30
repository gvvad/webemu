class RomList extends HTMLUListElement {
    constructor() {
        super();
        this.onItemActionEvent = new Event("onItemAction");
    }

    setData(data) {
        const tmp = document.querySelector("#tmp-rom-list-item");
        this.replaceChildren();
        for (const item of data) {
            let li = tmp.content.cloneNode(true);
            li.data = item;
            let actionId = 0;
            let a = li.querySelector("a")
            a.innerText = item;
            a.actionId = actionId++;
            a.onclick = this.listActionDispatcher.bind(this);
            a.rootElem = li;

            for (const menuItem of li.querySelector("ul").children) {
                if (menuItem.children[0].localName == "button") {
                    menuItem.children[0].actionId = actionId++;
                    menuItem.children[0].onclick = this.listActionDispatcher.bind(this);
                    menuItem.children[0].rootElem = li;
                }
            }
            
            this.appendChild(li);
        }
    }

    listActionDispatcher(event) {
        this.onItemActionEvent.result = event.target.rootElem.data;
        this.onItemActionEvent.actionId = event.target.actionId;
        this.dispatchEvent(this.onItemActionEvent);
    }
}

customElements.define("rom-list", RomList, { extends: "ul" });