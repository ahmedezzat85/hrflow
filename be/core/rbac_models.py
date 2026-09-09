"""
be/core/rbac_models.py
SQLAlchemy ORM models for Role-Based Access Control (RBAC).
Supports both SQLite and PostgreSQL.
"""
from datetime import datetime
from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    ForeignKey,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from db import Base


class PermissionDB(Base):
    __tablename__ = "permissions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    key = Column(String(100), unique=True, nullable=False, index=True)
    description = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    roles = relationship("RoleDB", secondary="role_permissions", back_populates="permissions", overlaps="role_permission_entries,permission,role")


class RoleDB(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), unique=True, nullable=False, index=True)
    description = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    permissions = relationship("PermissionDB", secondary="role_permissions", back_populates="roles", overlaps="role_permission_entries,permission,role")
    user_roles = relationship("UserRoleDB", back_populates="role", cascade="all, delete-orphan")


class RolePermissionDB(Base):
    __tablename__ = "role_permissions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    role_id = Column(Integer, ForeignKey("roles.id", ondelete="CASCADE"), nullable=False, index=True)
    permission_id = Column(Integer, ForeignKey("permissions.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("role_id", "permission_id", name="uq_role_permission"),
    )

    role = relationship("RoleDB", backref="role_permission_entries", overlaps="permissions,roles")
    permission = relationship("PermissionDB", backref="role_permission_entries", overlaps="permissions,roles")


class UserRoleDB(Base):
    __tablename__ = "user_roles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    role_id = Column(Integer, ForeignKey("roles.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("user_id", "role_id", name="uq_user_role"),
    )

    user = relationship("UserDB", back_populates="user_roles")
    role = relationship("RoleDB", back_populates="user_roles")


try:
    import models_db  # noqa: E402, F401
except ImportError:
    pass
