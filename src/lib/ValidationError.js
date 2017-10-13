/**
 * Created by bangbang93 on 2017/7/24.
 */
'use strict';
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
exports.__esModule = true;
var ValidationError = /** @class */ (function (_super) {
    __extends(ValidationError, _super);
    function ValidationError(content, channel, queue, validateError) {
        var _this = _super.call(this, validateError.message) || this;
        _this.content = content;
        _this.channel = channel;
        return _this;
    }
    return ValidationError;
}(Error));
exports.ValidationError = ValidationError;
