// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.7.0 and Community Contracts commit 0b4b981
pragma solidity ^0.8.27;

import {ERC20uRWA} from "@openzeppelin/community-contracts/contracts/token/ERC20/extensions/ERC20uRWA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";

contract NewBankDepositToken is ERC20, ERC20Burnable, ERC20Pausable, Ownable, ERC20uRWA {
    constructor(address initialOwner)
        ERC20("NewBankDepositToken", "NBDT")
        Ownable(initialOwner)
    {}

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }

    function canTransact(address user) public view override returns (bool) {
        return getRestriction(user) == Restriction.ALLOWED;
    }

    function allowUser(address user) public onlyOwner {
        _allowUser(user);
    }

    function disallowUser(address user) public onlyOwner {
        _resetUser(user);
    }

    function _checkFreezer(address, uint256) internal view override onlyOwner {}

    function _checkEnforcer(address, address, uint256) internal view override onlyOwner {}

    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Pausable, ERC20uRWA)
    {
        super._update(from, to, value);
    }
}
