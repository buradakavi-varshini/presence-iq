from getpass import getpass

import psycopg
from pwdlib import PasswordHash

from database import get_connection


def main():
    print("\nCreate your PresenceIQ admin account\n")

    full_name = input("Full name: ").strip()
    email = input("Login email: ").strip().lower()

    if not full_name or len(full_name) > 100:
        print("Enter a name between 1 and 100 characters.")
        return

    if (
        len(email) > 255
        or email.count("@") != 1
        or any(character.isspace() for character in email)
    ):
        print("Enter a valid email address.")
        return

    local_part, domain = email.split("@")

    if not local_part or "." not in domain or domain.startswith("."):
        print("Enter a valid email address.")
        return

    password = getpass("Choose a website password (minimum 12 characters): ")
    confirmation = getpass("Confirm your password: ")

    if len(password) < 12:
        print("Use at least 12 characters. Run the script again.")
        return

    if password != confirmation:
        print("Passwords do not match. Run the script again.")
        return

    password_hash = PasswordHash.recommended().hash(password)

    try:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO users
                        (full_name, email, password_hash, role)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (email) DO NOTHING
                    RETURNING id, full_name, email, role;
                    """,
                    (full_name, email, password_hash, "admin"),
                )

                admin = cursor.fetchone()

        if admin is None:
            print("An account with this email already exists.")
            print("Its password and role were not changed.")
            return

        print("\nAdmin account created successfully!")
        print(f"Name: {admin['full_name']}")
        print(f"Login email: {admin['email']}")
        print(f"Role: {admin['role']}")

    except psycopg.OperationalError:
        print("Could not connect to PostgreSQL.")
        print("Check the PostgreSQL service and backend/.env settings.")

    except psycopg.Error:
        print("Could not create the account.")
        print("Check that the users table was created in presence_iq.")


if __name__ == "__main__":
    main()