"""
be/finance/schemas.py
Pydantic request and response schemas for Finance domain resources.
"""
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field


# ==========================================
# Bank Account Schemas
# ==========================================
class BankAccountBase(BaseModel):
    account_name: str = Field(..., min_length=2, max_length=100, description="Friendly name for the account")
    bank_name: str = Field(..., min_length=2, max_length=100, description="Financial institution name")
    currency: str = Field("USD", min_length=3, max_length=10, description="ISO Currency code")
    opening_balance: float = Field(0.0, ge=0.0, description="Starting cash balance")


class BankAccountCreate(BankAccountBase):
    account_number: str = Field(..., min_length=4, max_length=50, description="Full bank account number")


class BankAccountUpdate(BaseModel):
    account_name: Optional[str] = Field(None, min_length=2, max_length=100)
    bank_name: Optional[str] = Field(None, min_length=2, max_length=100)
    account_number: Optional[str] = Field(None, min_length=4, max_length=50)
    currency: Optional[str] = Field(None, min_length=3, max_length=10)
    is_active: Optional[bool] = None


class BankAccountResponse(BankAccountBase):
    id: int
    account_number: str = Field(..., description="Masked account number")
    current_balance: float
    is_active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ==========================================
# Customer Schemas
# ==========================================
class CustomerBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255, description="Customer or company name")
    contact_email: Optional[str] = Field(None, max_length=255)
    contact_phone: Optional[str] = Field(None, max_length=50)
    tax_id: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = None


class CustomerCreate(CustomerBase):
    pass


class CustomerUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    contact_email: Optional[str] = Field(None, max_length=255)
    contact_phone: Optional[str] = Field(None, max_length=50)
    tax_id: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class CustomerResponse(CustomerBase):
    id: int
    is_active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ==========================================
# Vendor Schemas
# ==========================================
class VendorBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255, description="Vendor or supplier name")
    contact_email: Optional[str] = Field(None, max_length=255)
    contact_phone: Optional[str] = Field(None, max_length=50)
    tax_id: Optional[str] = Field(None, max_length=100)
    category: Optional[str] = Field("General", max_length=100)
    notes: Optional[str] = None


class VendorCreate(VendorBase):
    pass


class VendorUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    contact_email: Optional[str] = Field(None, max_length=255)
    contact_phone: Optional[str] = Field(None, max_length=50)
    tax_id: Optional[str] = Field(None, max_length=100)
    category: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class VendorResponse(VendorBase):
    id: int
    is_active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

