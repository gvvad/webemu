# 🕹️ WebEmu

WebEmu is a emulator of [Nintendo Entertainment System (NES)](https://en.wikipedia.org/wiki/Nintendo_Entertainment_System) written on javascript and optimized for working in web browsers.

## 🎯 Usage

Copy source to your web server, or use [github pages](https://gvvad.github.io/webemu/).

### 🎮 Default controllers


Controller|⬅️|➡️|⬆️|⬇️|`Select`|`Start`|🅰️|🅱️
-|-|-|-|-|-|-|-|-|
Keyboard|`Left`|`Right`|`Up`|`Down`|`Q`|`W`|`A`|`S`|
PS|`Left`|`Right`|`Up`|`Down`|`SHARE`|`OPTIONS`|`square`|`cross`|
Xbox|`Left`|`Right`|`Up`|`Down`|`BACK`|`START`|`X`|`A`|

## 🐞 Known issues

* Wrong behaviour at some roms.
* Sound issues at some roms.
* Graphical glitches at some roms.
* Not all mappers implemented.

ROM|Description|Note
-|-|-
[The Legend of Zelda](https://nescartdb.com/profile/view/173/the-legend-of-zelda)|Wrong behaviour at pause menu.|
[Mario Bros.](https://nescartdb.com/profile/view/1099/mario-bros)|Some fx sounds at wrong tone.|
[Tom & Jerry](https://nescartdb.com/profile/view/181/tom-jerry)|Vertical image jitter at intro screen.|
[Battletoads](https://nescartdb.com/profile/view/23/battletoads)|Vertical image jitter during the game.|
<!-- []()|| -->

## 📃 To do
* General bugfix.
* The DMC module needs to be improved and IRQ implemented.
* Addition mappers implementation.
* Web service worker ([PWA](https://en.wikipedia.org/wiki/Progressive_web_app)) realization.
* Adaptation web interface for mobile devices (virtual gamepad for touch screen).
* Implement 2nd player controller.

## 👀 Contributing

Any ideas for improvement are welcome.
